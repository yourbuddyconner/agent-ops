import { tool } from "@opencode-ai/plugin"
import { existsSync } from "fs"
import { isAbsolute, resolve } from "path"
import { execSync } from "child_process"

const WHISPER_MODELS_DIR = "/models/whisper"

const MODEL_FILES: Record<string, string> = {
  base: "ggml-base.en.bin",
  large: "ggml-large-v3.bin",
}

function resolveSourcePath(source: string): string {
  if (isAbsolute(source)) return source
  const workspaceRoot =
    process.env.WORKSPACE_DIR || process.env.OPENCODE_WORKSPACE || "/workspace"
  return resolve(workspaceRoot, source)
}

export default tool({
  description:
    "Transcribe an audio file to text using whisper.cpp (local speech-to-text). " +
    "Accepts common audio formats: wav, mp3, ogg, webm, flac, m4a, mp4. " +
    "Use the 'base' model (default) for fast transcription (~3-5s for 30s audio) or 'large' for higher accuracy.",
  args: {
    file_path: tool.schema
      .string()
      .describe(
        "Path to the audio file to transcribe (e.g. /workspace/recording.wav, meeting.mp3)",
      ),
    model: tool.schema
      .enum(["base", "large"])
      .optional()
      .describe("Whisper model to use: 'base' (fast, English) or 'large' (accurate, multilingual). Default: base"),
    language: tool.schema
      .string()
      .optional()
      .describe("Language code for transcription (e.g. 'en', 'es', 'fr'). Only used with 'large' model. Default: auto-detect"),
  },
  async execute(args) {
    const { file_path, model = "base", language } = args

    const resolvedPath = resolveSourcePath(file_path)
    if (!existsSync(resolvedPath)) {
      return `File not found: ${resolvedPath}`
    }

    const modelFile = MODEL_FILES[model]
    if (!modelFile) {
      return `Unknown model: ${model}. Use 'base' or 'large'.`
    }

    const modelPath = `${WHISPER_MODELS_DIR}/${modelFile}`
    if (!existsSync(modelPath)) {
      return `Whisper model not found at ${modelPath}. The whisper models volume may not be mounted.`
    }

    const uid = Date.now()
    const outPath = `/tmp/whisper-${uid}`
    const wavPath = `/tmp/whisper-${uid}.wav`

    try {
      const { readFileSync, unlinkSync } = await import("fs")

      // Convert to WAV (16kHz mono) if not already WAV — whisper-cli needs WAV input
      const ext = resolvedPath.split('.').pop()?.toLowerCase()
      const needsConvert = ext !== 'wav'
      const whisperInput = needsConvert ? wavPath : resolvedPath

      if (needsConvert) {
        execSync(
          `ffmpeg -i "${resolvedPath}" -ar 16000 -ac 1 -c:a pcm_s16le -y "${wavPath}"`,
          { timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] },
        )
      }

      const cmd = [
        "whisper-cli",
        "--model", modelPath,
        "--file", whisperInput,
        "--output-txt",
        "--output-file", outPath,
        "--no-timestamps",
      ]

      if (language && model === "large") {
        cmd.push("--language", language)
      }

      execSync(cmd.join(" "), {
        timeout: 120_000,
        stdio: ["pipe", "pipe", "pipe"],
      })

      const txtPath = `${outPath}.txt`
      if (!existsSync(txtPath)) {
        return "Transcription completed but no output file was produced."
      }

      const transcript = readFileSync(txtPath, "utf-8").trim()

      // Clean up
      try { unlinkSync(txtPath) } catch {}
      if (needsConvert) { try { unlinkSync(wavPath) } catch {} }

      if (!transcript) {
        return "Transcription completed but the result was empty (no speech detected)."
      }

      return transcript
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Clean up on error
      try { const { unlinkSync } = await import("fs"); unlinkSync(wavPath) } catch {}
      return `Transcription failed: ${msg}`
    }
  },
})
