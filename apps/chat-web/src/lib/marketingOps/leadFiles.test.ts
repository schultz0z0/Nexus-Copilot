// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseLeadCsv, parseLeadXlsx, mapLeadRows } from './leadFiles';

describe('lead file review parsing', () => {
  it('handles BOM, Brazilian separator, quoted commas, multiline and escaped quotes', () => {
    const parsed = parseLeadCsv('\ufeffNome;Email;Empresa\r\n"Ana; Silva";ana@example.test;"Linha 1\nLinha ""2"""\r\n');
    expect(parsed.headers).toEqual(['Nome', 'Email', 'Empresa']);
    expect(parsed.rows).toEqual([['Ana; Silva', 'ana@example.test', 'Linha 1\nLinha "2"']]);
  });
  it('rejects malformed quotes, repeated headers and excess rows without truncating', () => {
    for (const value of ['Nome,Email\n"Ana,ana@example.test', 'Nome,Nome\nA,B', `Nome,Email\n${Array(501).fill('A,a@example.test').join('\n')}`]) expect(() => parseLeadCsv(value)).toThrow();
  });
  it('reads XLSX shared/inline strings in column positions without evaluating formulas', () => {
    const archive = zipSync({
      'xl/workbook.xml': strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Leads" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>Nome</t></si><si><t>Email</t></si><si><t>Ana</t></si></sst>'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="A2" t="s"><v>2</v></c><c r="B2" t="inlineStr"><is><t>ana@example.test</t></is></c></row></sheetData></worksheet>')
    });
    expect(parseLeadXlsx(archive).rows).toEqual([['Ana', 'ana@example.test']]);
  });
  it('rejects XML declarations/entities and oversized XLSX contents', () => {
    expect(() => parseLeadXlsx(zipSync({ 'xl/workbook.xml': strToU8('<!DOCTYPE workbook><workbook/>') }))).toThrow();
    expect(() => parseLeadXlsx(zipSync({ 'xl/workbook.xml': new Uint8Array(8_000_001) }))).toThrow();
  });
  it('maps only selected columns and preserves invalid rows for server review', () => {
    const table = parseLeadCsv('Nome;Email;Telefone;Data\nAna;ana@example.test;;28/09/2026 10:30\nSem contato;;;');
    const result = mapLeadRows(table, { name: 0, email: 1, phone: 2, occurredAt: 3 }, '2026-09-30T12:00:00-03:00');
    expect(result[0]).toEqual({ name: 'Ana', email: 'ana@example.test', occurredAt: '2026-09-28T10:30:00-03:00' });
    expect(result[1]).toEqual({ name: 'Sem contato', occurredAt: '2026-09-30T12:00:00-03:00' });
  });
  it('keeps date-only captures on their local day without placing morning imports in the future', () => {
    const rows = mapLeadRows(parseLeadCsv('Nome;Email;Data\nAna;ana@example.test;30/09/2026\nBia;bia@example.test;2026-09-30\nCaio;caio@example.test;'), { name: 0, email: 1, occurredAt: 2 }, '2026-09-30');
    const morning = Date.parse('2026-09-30T08:00:00-03:00');
    for (const row of rows) {
      expect(Date.parse(row.occurredAt)).toBeLessThanOrEqual(morning);
      expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(row.occurredAt))).toBe('2026-09-30');
    }
  });
});
