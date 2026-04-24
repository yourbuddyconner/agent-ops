/**
 * Agent-dispatched smoke test: Google Workspace integration.
 *
 * Exercises Drive, Docs, and Sheets actions end-to-end via call_tool.
 * Covers the full lifecycle: create, read, modify, format, chart, table,
 * tabs, comments, and cleanup.
 *
 * The prompt is structured in phases so dependent steps run in order while
 * independent checks within a phase can run in parallel.
 */

import { describe, it, expect } from 'vitest';
import { SmokeClient } from './client.js';
import { dispatchAndWait, assertSmokeTestResult, type SmokeTestResult, type AgentResponse } from './agent.js';
import { ToolCallTrace } from './tool-trace.js';
import { assertRefreshReproducesState } from './refresh-helper.js';

const client = new SmokeClient();

const PROMPT = `You are running an automated smoke test for the Google Workspace integration (Drive, Docs, Sheets). Execute each check below IN ORDER and produce ONLY a JSON object as your final message — no markdown, no commentary, no code fences. The JSON must be parseable.

CRITICAL TESTING RULES:
- Each check has an explicit EXPECT line describing the exact tool output that constitutes success.
- If the tool returns ANYTHING other than what EXPECT specifies — including errors, empty results, or unexpected shapes — set pass=false and put the LITERAL tool output in the detail field.
- Record LITERAL outputs, not your interpretation. Do NOT rationalize failures as success.
- Run phases sequentially (later phases depend on earlier ones). Within a phase, run independent checks in parallel.

═══ PHASE 1: Setup ═══

1. TOOLS_LIST: Call list_tools with service=google_workspace. Count the tools.
   EXPECT: non-empty list with at least 50 tools. Record count.

2. CREATE_FOLDER: Call call_tool google_workspace:drive.create_folder with params {"name":"Smoke Test GWS"}.
   EXPECT: response contains an id and a webViewLink. Capture the folder id.

3. CREATE_DOC: Call call_tool google_workspace:drive.create_document with params {"title":"Smoke Test Doc","markdown":"# Smoke Test\\n\\nHello from the smoke test.\\n\\n| Col A | Col B |\\n|-------|-------|\\n| 1 | 2 |","folderId":"<folder id from step 2>"}.
   EXPECT: response contains an id and url. Capture the doc id.

4. CREATE_SHEET: Call call_tool google_workspace:sheets.create_spreadsheet with params {"title":"Smoke Test Sheet","sheetTitles":["Data","Charts","Tables"]}.
   EXPECT: response contains a spreadsheetId and 3 sheets. Capture the spreadsheetId and the numeric sheetId for each sheet.

═══ PHASE 2: Docs — Read/Write ═══

5. READ_DOC_MARKDOWN: Call call_tool google_workspace:docs.read_document with params {"documentId":"<doc id>","format":"markdown"}.
   EXPECT: content includes "Smoke Test" heading and the table with "Col A" and "Col B".

6. MODIFY_TEXT: Call call_tool google_workspace:docs.modify_text with params {"documentId":"<doc id>","target":{"textToFind":"Hello from the smoke test"},"text":"Updated by smoke test"}.
   EXPECT: response says "Successfully replaced text".

7. VERIFY_MODIFY: Call call_tool google_workspace:docs.read_document with params {"documentId":"<doc id>","format":"text"}.
   EXPECT: content includes "Updated by smoke test" and does NOT include "Hello from the smoke test".

═══ PHASE 3: Docs — Tabs ═══

8. ADD_TAB: Call call_tool google_workspace:docs.add_tab with params {"documentId":"<doc id>","title":"Sub Notes"}.
   EXPECT: response includes tabId and title "Sub Notes". Capture the tabId.

9. ADD_CHILD_TAB: Call call_tool google_workspace:docs.add_tab with params {"documentId":"<doc id>","title":"Nested Tab","parentTabId":"<tabId from step 8>"}.
   EXPECT: response includes tabId and parentTabId. Capture child tabId.

10. RENAME_CHILD_TAB: Call call_tool google_workspace:docs.rename_tab with params {"documentId":"<doc id>","tabId":"<child tabId from step 9>","newTitle":"Renamed Nested"}.
    EXPECT: response says "Successfully renamed tab". This specifically tests nested/child tab renaming.

11. LIST_TABS: Call call_tool google_workspace:docs.list_tabs with params {"documentId":"<doc id>","includeContent":true}.
    EXPECT: 3 tabs total. One named "Renamed Nested" with a parentTabId.

═══ PHASE 4: Docs — Comments ═══

12. ADD_COMMENT: Call call_tool google_workspace:docs.add_comment with params {"documentId":"<doc id>","startIndex":2,"endIndex":12,"content":"Smoke test comment"}.
    EXPECT: response includes a comment ID. Capture it.

13. RESOLVE_COMMENT: Call call_tool google_workspace:docs.resolve_comment with params {"documentId":"<doc id>","commentId":"<comment id from step 12>"}.
    EXPECT: response says comment has been resolved.

14. LIST_COMMENTS: Call call_tool google_workspace:docs.list_comments with params {"documentId":"<doc id>"}.
    EXPECT: at least 1 comment, and the one from step 12 shows resolved=true.

═══ PHASE 5: Sheets — Data & Formulas ═══

15. WRITE_DATA: Call call_tool google_workspace:sheets.write_spreadsheet with params {"spreadsheetId":"<sheet id>","range":"Data!A1:D5","data":[["Month","Revenue","Cost","Profit"],["Jan","50000","30000","=B2-C2"],["Feb","55000","32000","=B3-C3"],["Mar","62000","35000","=B4-C4"],["Apr","58000","33000","=B5-C5"]],"valueInputOption":"USER_ENTERED"}.
    EXPECT: updatedCells = 20.

16. READ_FORMULAS: Call call_tool google_workspace:sheets.read_spreadsheet with params {"spreadsheetId":"<sheet id>","range":"Data!D2:D5"}.
    EXPECT: 4 values, all positive numbers (formula results: 20000, 23000, 27000, 25000).

═══ PHASE 6: Sheets — Formatting ═══

17. FORMAT_HEADER: Call call_tool google_workspace:sheets.format_cells with params {"spreadsheetId":"<sheet id>","range":"Data!A1:D1","format":{"bold":true,"backgroundColor":"#1A237E","foregroundColor":"#FFFFFF","horizontalAlignment":"CENTER"}}.
    EXPECT: updatedRange matches "Data!A1:D1".

18. SET_BORDERS_RGB: Call call_tool google_workspace:sheets.set_cell_borders with params {"spreadsheetId":"<sheet id>","range":"Data!A1:D5","borders":{"top":{"style":"SOLID_THICK","color":{"red":0,"green":0,"blue":0}},"bottom":{"style":"SOLID_THICK","color":{"red":0,"green":0,"blue":0}},"innerHorizontal":{"style":"DASHED","color":"#CCCCCC"},"innerVertical":{"style":"DASHED","color":"#CCCCCC"}}}.
    EXPECT: response succeeds with range. This tests both RGB object AND hex string colors in the same call.

19. COND_FORMAT_BOLD: Call call_tool google_workspace:sheets.add_conditional_formatting with params {"spreadsheetId":"<sheet id>","range":"Data!B2:B5","conditionType":"NUMBER_GREATER","conditionValues":["55000"],"format":{"backgroundColor":"#E8F5E9","bold":true}}.
    EXPECT: response succeeds. "bold" is at the TOP LEVEL of format (not nested in textFormat).

20. VERIFY_COND_FORMAT: Call call_tool google_workspace:sheets.get_conditional_formatting with params {"spreadsheetId":"<sheet id>","sheetName":"Data"}.
    EXPECT: at least 1 rule. The rule's format should have bold=true (check if the bold actually made it through).

═══ PHASE 7: Sheets — Charts (all 7 types) ═══

21. CHART_LINE: Call call_tool google_workspace:sheets.insert_chart with params {"spreadsheetId":"<sheet id>","sheetName":"Charts","chartType":"LINE","sourceRange":"Data!A1:D5","title":"Line Chart"}.
    EXPECT: returns chartId.

22. CHART_COLUMN: Call call_tool google_workspace:sheets.insert_chart with params {"spreadsheetId":"<sheet id>","sheetName":"Charts","chartType":"COLUMN","sourceRange":"Data!A1:D5","title":"Column Chart"}.
    EXPECT: returns chartId.

23. CHART_BAR: Call call_tool google_workspace:sheets.insert_chart with params {"spreadsheetId":"<sheet id>","sheetName":"Charts","chartType":"BAR","sourceRange":"Data!A1:C5","title":"Bar Chart"}.
    EXPECT: returns chartId. BAR charts previously failed with 400.

24. CHART_PIE: Call call_tool google_workspace:sheets.insert_chart with params {"spreadsheetId":"<sheet id>","sheetName":"Charts","chartType":"PIE","sourceRange":"Data!A1:B5","title":"Pie Chart"}.
    EXPECT: returns chartId. PIE charts previously failed with 400.

25. CHART_AREA: Call call_tool google_workspace:sheets.insert_chart with params {"spreadsheetId":"<sheet id>","sheetName":"Charts","chartType":"AREA","sourceRange":"Data!A1:D5","title":"Area Chart"}.
    EXPECT: returns chartId.

26. CHART_SCATTER: Call call_tool google_workspace:sheets.insert_chart with params {"spreadsheetId":"<sheet id>","sheetName":"Charts","chartType":"SCATTER","sourceRange":"Data!B1:C5","title":"Scatter Chart"}.
    EXPECT: returns chartId.

27. CHART_COMBO: Call call_tool google_workspace:sheets.insert_chart with params {"spreadsheetId":"<sheet id>","sheetName":"Charts","chartType":"COMBO","sourceRange":"Data!A1:D5","title":"Combo Chart"}.
    EXPECT: returns chartId. COMBO charts previously failed with 400.

═══ PHASE 8: Sheets — Tables ═══

28. TABLE_WRITE: Call call_tool google_workspace:sheets.write_spreadsheet with params {"spreadsheetId":"<sheet id>","range":"Tables!A1:C3","data":[["Item","Qty","Price"],["Widget",10,5.99],["Gadget",25,12.50]]}.
    EXPECT: updatedCells = 9.

29. TABLE_CREATE: Call call_tool google_workspace:sheets.create_table with params {"spreadsheetId":"<sheet id>","sheetName":"Tables","name":"InventoryTable","range":"Tables!A1:C3","columns":["Item","Qty","Price"]}.
    EXPECT: returns a tableId. Capture it.

30. TABLE_APPEND: Call call_tool google_workspace:sheets.append_table_rows with params {"spreadsheetId":"<sheet id>","tableId":"<tableId from step 29>","values":[["Doohickey",5,24.99],["Thingamajig",50,1.25]]}.
    EXPECT: rowsAppended = 2.

31. TABLE_RANGE_EXPANDED: Call call_tool google_workspace:sheets.get_table with params {"spreadsheetId":"<sheet id>","tableIdentifier":"InventoryTable"}.
    EXPECT: range covers rows through 5 (A1:C5), not the original A1:C3. Confirms auto-expansion.

32. TABLE_DELETE_PRESERVE: Call call_tool google_workspace:sheets.delete_table with params {"spreadsheetId":"<sheet id>","tableId":"<tableId from step 29>","deleteData":false}.
    EXPECT: deleted=true, dataCleared=false.

33. TABLE_DATA_INTACT: Call call_tool google_workspace:sheets.read_spreadsheet with params {"spreadsheetId":"<sheet id>","range":"Tables!A1:C5"}.
    EXPECT: 5 rows of data still present (header + 4 data rows). Data was preserved despite table deletion.

═══ PHASE 9: Drive — File Operations ═══

34. MOVE_DOC: Call call_tool google_workspace:drive.move_file with params {"fileId":"<doc id>","folderId":"<folder id>"}.
    EXPECT: response shows the doc's parent is now the folder id.

35. LIST_FOLDER: Call call_tool google_workspace:drive.list_folder_contents with params {"folderId":"<folder id>"}.
    EXPECT: at least 1 file (the doc).

36. SEARCH_FILES: Call call_tool google_workspace:drive.search_files with params {"query":"Smoke Test","searchIn":"name","maxResults":5}.
    EXPECT: results include both "Smoke Test Doc" and "Smoke Test Sheet".

═══ PHASE 10: Cleanup ═══

37. DELETE_DOC: Call call_tool google_workspace:drive.delete_file with params {"fileId":"<doc id>"}.
    EXPECT: success (trashed).

38. DELETE_SHEET: Call call_tool google_workspace:drive.delete_file with params {"fileId":"<sheet id>"}.
    EXPECT: success (trashed).

39. DELETE_FOLDER: Call call_tool google_workspace:drive.delete_file with params {"fileId":"<folder id>"}.
    EXPECT: success (trashed).

Output ONLY this JSON:

{"smoke_test":"google_workspace","timestamp":"<ISO8601 now>","checks":{"tools_list":{"pass":true,"detail":"N tools"},"create_folder":{"pass":true,"detail":"id=X"},"create_doc":{"pass":true,"detail":"id=X"},"create_sheet":{"pass":true,"detail":"id=X, 3 sheets"},"read_doc_markdown":{"pass":true,"detail":"has heading + table"},"modify_text":{"pass":true,"detail":"<literal>"},"verify_modify":{"pass":true,"detail":"text updated"},"add_tab":{"pass":true,"detail":"tabId=X"},"add_child_tab":{"pass":true,"detail":"tabId=X parentTabId=X"},"rename_child_tab":{"pass":true,"detail":"<literal>"},"list_tabs":{"pass":true,"detail":"N tabs, nested found"},"add_comment":{"pass":true,"detail":"commentId=X"},"resolve_comment":{"pass":true,"detail":"<literal>"},"list_comments":{"pass":true,"detail":"N comments, resolved=true"},"write_data":{"pass":true,"detail":"20 cells"},"read_formulas":{"pass":true,"detail":"values: [...]"},"format_header":{"pass":true,"detail":"<literal>"},"set_borders_rgb":{"pass":true,"detail":"<literal>"},"cond_format_bold":{"pass":true,"detail":"<literal>"},"verify_cond_format":{"pass":true,"detail":"N rules, bold=X"},"chart_line":{"pass":true,"detail":"chartId=X"},"chart_column":{"pass":true,"detail":"chartId=X"},"chart_bar":{"pass":true,"detail":"chartId=X"},"chart_pie":{"pass":true,"detail":"chartId=X"},"chart_area":{"pass":true,"detail":"chartId=X"},"chart_scatter":{"pass":true,"detail":"chartId=X"},"chart_combo":{"pass":true,"detail":"chartId=X"},"table_write":{"pass":true,"detail":"9 cells"},"table_create":{"pass":true,"detail":"tableId=X"},"table_append":{"pass":true,"detail":"2 rows"},"table_range_expanded":{"pass":true,"detail":"range=X"},"table_delete_preserve":{"pass":true,"detail":"deleted, data kept"},"table_data_intact":{"pass":true,"detail":"5 rows"},"move_doc":{"pass":true,"detail":"<literal>"},"list_folder":{"pass":true,"detail":"N files"},"search_files":{"pass":true,"detail":"found doc + sheet"},"delete_doc":{"pass":true,"detail":"trashed"},"delete_sheet":{"pass":true,"detail":"trashed"},"delete_folder":{"pass":true,"detail":"trashed"}},"summary":{"total":39,"passed":N,"failed":N}}

Set pass=false and include the error in detail for any check that fails. Do not omit failed checks.`;

describe('agent: google workspace integration', () => {
  let result: SmokeTestResult;
  let trace: ToolCallTrace;
  let response: AgentResponse;

  it('dispatches prompt and receives JSON response', async () => {
    response = await dispatchAndWait(client, PROMPT, { timeoutMs: 240_000 });

    console.log(`Agent responded in ${response.durationMs}ms`);
    console.log(`Raw response (first 500 chars): ${response.raw.slice(0, 500)}`);

    assertSmokeTestResult(response.json);
    result = response.json;
    expect(result.smoke_test).toBe('google_workspace');

    trace = new ToolCallTrace(response.messages);
    console.log(`Tool calls observed: ${trace.calls.map((c) => c.toolName).join(', ') || '(none)'}`);
    console.log(`\nAgent smoke test summary: ${result.summary.passed}/${result.summary.total} passed`);
  });

  // ── Phase 1: Setup ────────────────────────────────────────────────────────

  it('tools list', () => {
    expect(result?.checks?.tools_list?.pass).toBe(true);
  });

  it('create folder', () => {
    expect(result?.checks?.create_folder?.pass).toBe(true);
  });

  it('create doc', () => {
    expect(result?.checks?.create_doc?.pass).toBe(true);
  });

  it('create spreadsheet', () => {
    expect(result?.checks?.create_sheet?.pass).toBe(true);
  });

  // ── Phase 2: Docs Read/Write ──────────────────────────────────────────────

  it('read doc as markdown', () => {
    expect(result?.checks?.read_doc_markdown?.pass).toBe(true);
  });

  it('modify text (find and replace)', () => {
    expect(result?.checks?.modify_text?.pass).toBe(true);
  });

  it('verify modification persisted', () => {
    expect(result?.checks?.verify_modify?.pass).toBe(true);
  });

  // ── Phase 3: Docs Tabs ────────────────────────────────────────────────────

  it('add tab', () => {
    expect(result?.checks?.add_tab?.pass).toBe(true);
  });

  it('add nested child tab', () => {
    expect(result?.checks?.add_child_tab?.pass).toBe(true);
  });

  it('rename nested child tab (regression: previously "Tab not found")', () => {
    expect(result?.checks?.rename_child_tab?.pass).toBe(true);
  });

  it('list tabs shows hierarchy', () => {
    expect(result?.checks?.list_tabs?.pass).toBe(true);
  });

  // ── Phase 4: Docs Comments ────────────────────────────────────────────────

  it('add comment', () => {
    expect(result?.checks?.add_comment?.pass).toBe(true);
  });

  it('resolve comment', () => {
    expect(result?.checks?.resolve_comment?.pass).toBe(true);
  });

  it('list comments (resolved)', () => {
    expect(result?.checks?.list_comments?.pass).toBe(true);
  });

  // ── Phase 5: Sheets Data & Formulas ───────────────────────────────────────

  it('write data with formulas', () => {
    expect(result?.checks?.write_data?.pass).toBe(true);
  });

  it('read computed formula results', () => {
    expect(result?.checks?.read_formulas?.pass).toBe(true);
  });

  // ── Phase 6: Sheets Formatting ────────────────────────────────────────────

  it('format header cells', () => {
    expect(result?.checks?.format_header?.pass).toBe(true);
  });

  it('set borders with RGB objects (regression: previously "Expected string")', () => {
    expect(result?.checks?.set_borders_rgb?.pass).toBe(true);
  });

  it('conditional formatting with top-level bold (regression: bold was ignored)', () => {
    expect(result?.checks?.cond_format_bold?.pass).toBe(true);
  });

  it('verify conditional formatting has bold', () => {
    expect(result?.checks?.verify_cond_format?.pass).toBe(true);
  });

  // ── Phase 7: Charts (all 7 types) ────────────────────────────────────────

  it('chart: LINE', () => {
    expect(result?.checks?.chart_line?.pass).toBe(true);
  });

  it('chart: COLUMN', () => {
    expect(result?.checks?.chart_column?.pass).toBe(true);
  });

  it('chart: BAR (regression: previously 400)', () => {
    expect(result?.checks?.chart_bar?.pass).toBe(true);
  });

  it('chart: PIE (regression: previously 400)', () => {
    expect(result?.checks?.chart_pie?.pass).toBe(true);
  });

  it('chart: AREA', () => {
    expect(result?.checks?.chart_area?.pass).toBe(true);
  });

  it('chart: SCATTER', () => {
    expect(result?.checks?.chart_scatter?.pass).toBe(true);
  });

  it('chart: COMBO (regression: previously 400)', () => {
    expect(result?.checks?.chart_combo?.pass).toBe(true);
  });

  // ── Phase 8: Tables ───────────────────────────────────────────────────────

  it('write table data', () => {
    expect(result?.checks?.table_write?.pass).toBe(true);
  });

  it('create named table', () => {
    expect(result?.checks?.table_create?.pass).toBe(true);
  });

  it('append rows to table', () => {
    expect(result?.checks?.table_append?.pass).toBe(true);
  });

  it('table range auto-expanded (regression: range stayed at original)', () => {
    expect(result?.checks?.table_range_expanded?.pass).toBe(true);
  });

  it('delete table preserves data (regression: data was lost)', () => {
    expect(result?.checks?.table_delete_preserve?.pass).toBe(true);
  });

  it('table data intact after delete', () => {
    expect(result?.checks?.table_data_intact?.pass).toBe(true);
  });

  // ── Phase 9: Drive File Operations ────────────────────────────────────────

  it('move doc to folder', () => {
    expect(result?.checks?.move_doc?.pass).toBe(true);
  });

  it('list folder contents', () => {
    expect(result?.checks?.list_folder?.pass).toBe(true);
  });

  it('search files by name', () => {
    expect(result?.checks?.search_files?.pass).toBe(true);
  });

  // ── Phase 10: Cleanup ─────────────────────────────────────────────────────

  it('delete doc', () => {
    expect(result?.checks?.delete_doc?.pass).toBe(true);
  });

  it('delete spreadsheet', () => {
    expect(result?.checks?.delete_sheet?.pass).toBe(true);
  });

  it('delete folder', () => {
    expect(result?.checks?.delete_folder?.pass).toBe(true);
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  it('no failures in summary', () => {
    expect(result?.summary?.failed).toBe(0);
  });

  // ── Tool-trace assertions ─────────────────────────────────────────────────

  it('trace: list_tools was called', () => {
    trace.expectCalled('list_tools');
  });

  it('trace: call_tool was called (all actions go through call_tool)', () => {
    trace.expectCalled('call_tool');
  });

  it('trace: no orphaned non-terminal tool calls', () => {
    trace.expectAllTerminal();
  });

  it('trace: no tool call errors', () => {
    trace.expectNoErrors();
  });

  it('refresh round-trip: persisted state matches live response', async () => {
    await assertRefreshReproducesState(client, response);
  });
});
