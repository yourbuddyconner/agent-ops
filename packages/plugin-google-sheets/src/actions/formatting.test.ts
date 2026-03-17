import { describe, it, expect } from 'vitest';
import { buildFieldMask } from './formatting.js';

describe('buildFieldMask', () => {
  it('returns mask for a single top-level property', () => {
    const mask = buildFieldMask({ backgroundColor: { red: 1 } });
    expect(mask).toBe('userEnteredFormat.backgroundColor');
  });

  it('returns mask for nested textFormat properties', () => {
    const mask = buildFieldMask({ textFormat: { bold: true, fontSize: 12 } });
    const parts = mask.split(',').sort();
    expect(parts).toEqual([
      'userEnteredFormat.textFormat.bold',
      'userEnteredFormat.textFormat.fontSize',
    ]);
  });

  it('returns mask for textFormat.foregroundColor as a single leaf', () => {
    const mask = buildFieldMask({ textFormat: { foregroundColor: { red: 1 } } });
    expect(mask).toBe('userEnteredFormat.textFormat.foregroundColor');
  });

  it('returns mask for border sides', () => {
    const mask = buildFieldMask({
      borders: { top: { style: 'SOLID' }, bottom: { style: 'DASHED' } },
    });
    const parts = mask.split(',').sort();
    expect(parts).toEqual([
      'userEnteredFormat.borders.bottom',
      'userEnteredFormat.borders.top',
    ]);
  });

  it('returns mask for multiple top-level properties', () => {
    const mask = buildFieldMask({
      backgroundColor: { red: 0.5 },
      horizontalAlignment: 'CENTER',
    });
    const parts = mask.split(',').sort();
    expect(parts).toEqual([
      'userEnteredFormat.backgroundColor',
      'userEnteredFormat.horizontalAlignment',
    ]);
  });

  it('combines all property types', () => {
    const mask = buildFieldMask({
      backgroundColor: { red: 1 },
      textFormat: { bold: true },
      horizontalAlignment: 'LEFT',
      wrapStrategy: 'WRAP',
      numberFormat: { type: 'NUMBER' },
      borders: { left: { style: 'SOLID' } },
    });
    const parts = mask.split(',').sort();
    expect(parts).toEqual([
      'userEnteredFormat.backgroundColor',
      'userEnteredFormat.borders.left',
      'userEnteredFormat.horizontalAlignment',
      'userEnteredFormat.numberFormat',
      'userEnteredFormat.textFormat.bold',
      'userEnteredFormat.wrapStrategy',
    ]);
  });

  it('returns empty string for empty format', () => {
    expect(buildFieldMask({})).toBe('');
  });
});
