import { strFromU8, unzipSync } from 'fflate';
import type { LeadRow } from './leads';

export interface LeadTable { headers: string[]; rows: string[][] }
export type LeadMapping = Partial<Record<'name' | 'email' | 'phone' | 'company' | 'externalId' | 'occurredAt', number>>;
const maximumRows = 500;
function table(rows: string[][]): LeadTable {
  const nonempty = rows.filter(row => row.some(value => value.trim()));
  const headers = nonempty.shift()?.map(value => value.trim()) ?? [];
  if (!headers.length || headers.length > 40 || headers.some(value => !value) || new Set(headers.map(value => value.toLocaleLowerCase('pt-BR'))).size !== headers.length) throw new Error('Use até 40 colunas com cabeçalhos únicos e preenchidos.');
  if (!nonempty.length) throw new Error('O arquivo não contém contatos.');
  if (nonempty.length > maximumRows) throw new Error('Importe até 500 contatos por arquivo. Divida o arquivo e revise cada lote.');
  if (nonempty.some(row => row.length > headers.length || row.some(value => value.length > 4000))) throw new Error('O arquivo contém linhas com colunas ou textos fora do limite.');
  return { headers, rows: nonempty.map(row => headers.map((_, index) => row[index] ?? '')) };
}

export function parseLeadCsv(value: string): LeadTable {
  if (new TextEncoder().encode(value).length > 4_000_000) throw new Error('O arquivo deve ter até 4 MB.');
  const input = value.replace(/^\ufeff/, '');
  // Count separators in the header outside quoted cells.
  let quoted = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') { if (quoted && input[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && char in counts) counts[char as keyof typeof counts]++;
  }
  const separator = Object.keys(counts).sort((a, b) => counts[b as keyof typeof counts] - counts[a as keyof typeof counts])[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = '', inQuotes = false, closedQuote = false;
  const pushCell = () => { row.push(cell); cell = ''; closedQuote = false; };
  const pushRow = () => { pushCell(); rows.push(row); row = []; if (rows.length > maximumRows + 2) throw new Error('Importe até 500 contatos por arquivo.'); };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') { if (input[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; closedQuote = true; } }
      else cell += char;
    } else if (char === '"') {
      if (cell || closedQuote) throw new Error('Confira as aspas do arquivo CSV.');
      inQuotes = true;
    } else if (char === separator) pushCell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && input[i + 1] === '\n') i++; pushRow(); }
    else if (closedQuote) { if (char !== ' ') throw new Error('Confira os delimitadores após as aspas.'); }
    else cell += char;
  }
  if (inQuotes) throw new Error('Uma célula CSV contém aspas sem fechamento.');
  if (cell || row.length || closedQuote) pushRow();
  return table(rows);
}

function xml(value: Uint8Array | undefined): Document {
  if (!value) throw new Error('A planilha está incompleta.');
  const content = strFromU8(value);
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) throw new Error('A planilha contém declarações XML não permitidas.');
  const document = new DOMParser().parseFromString(content, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('A planilha contém XML inválido.');
  return document;
}
export function parseLeadXlsx(bytes: Uint8Array): LeadTable {
  if (bytes.byteLength > 4_000_000) throw new Error('O arquivo deve ter até 4 MB.');
  let total = 0, entries = 0;
  const files = unzipSync(bytes, { filter: info => {
    if (++entries > 1000) throw new Error('A planilha contém arquivos demais.');
    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(info.name)) return false;
    total += info.originalSize;
    if (total > 8_000_000 || info.originalSize > 8_000_000) throw new Error('O conteúdo da planilha excede 8 MB.');
    return true;
  } });
  const workbook = xml(files['xl/workbook.xml']);
  const sheet = Array.from(workbook.getElementsByTagName('sheet')).find(item => !['hidden', 'veryHidden'].includes(item.getAttribute('state') ?? ''));
  const relationshipId = sheet?.getAttribute('r:id') ?? sheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const relations = xml(files['xl/_rels/workbook.xml.rels']);
  const relationship = Array.from(relations.getElementsByTagName('Relationship')).find(item => item.getAttribute('Id') === relationshipId);
  const target = relationship?.getAttribute('Target')?.replace(/^\/xl\//, '').replace(/^\.\//, '');
  if (!target || !/^worksheets\/[^/]+\.xml$/.test(target) || relationship?.getAttribute('TargetMode') === 'External') throw new Error('A primeira aba visível não está disponível.');
  const document = xml(files[`xl/${target}`]);
  const strings = files['xl/sharedStrings.xml'] ? Array.from(xml(files['xl/sharedStrings.xml']).getElementsByTagName('si')).map(item => Array.from(item.getElementsByTagName('t')).map(text => text.textContent ?? '').join('')) : [];
  const styles = files['xl/styles.xml'] ? xml(files['xl/styles.xml']) : null;
  const dateFormats = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  for (const format of Array.from(styles?.getElementsByTagName('numFmt') ?? [])) if (/[yd]/i.test((format.getAttribute('formatCode') ?? '').replace(/"[^"]*"/g, ''))) dateFormats.add(Number(format.getAttribute('numFmtId')));
  const formats = Array.from(styles?.getElementsByTagName('cellXfs')[0]?.getElementsByTagName('xf') ?? []).map(item => Number(item.getAttribute('numFmtId')));
  const epoch = ['1', 'true'].includes(workbook.getElementsByTagName('workbookPr')[0]?.getAttribute('date1904') ?? '') ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const rows = Array.from(document.getElementsByTagName('row'));
  if (rows.length > maximumRows + 1) throw new Error('Importe até 500 contatos por arquivo.');
  return table(rows.map(element => {
    const row: string[] = [];
    for (const cell of Array.from(element.getElementsByTagName('c'))) {
      const letters = cell.getAttribute('r')?.match(/^[A-Z]+/)?.[0];
      if (!letters) throw new Error('A planilha contém posições de células inválidas.');
      const index = Array.from(letters).reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
      if (index >= 40) throw new Error('Use até 40 colunas por planilha.');
      const raw = cell.getElementsByTagName('v')[0]?.textContent ?? '';
      const type = cell.getAttribute('t');
      if (cell.getElementsByTagName('f').length) throw new Error('Exporte a planilha como valores, sem fórmulas.');
      if (type === 's') row[index] = strings[Number(raw)] ?? '';
      else if (type === 'inlineStr') row[index] = Array.from(cell.getElementsByTagName('t')).map(text => text.textContent ?? '').join('');
      else if (raw && dateFormats.has(formats[Number(cell.getAttribute('s') ?? '0')])) row[index] = new Date(epoch + Math.round(Number(raw) * 86400000)).toISOString().slice(0, 19); // local spreadsheet time, normalized below
      else row[index] = raw;
    }
    return Array.from({ length: row.length }, (_, index) => row[index] ?? '');
  }));
}
export async function readLeadFile(file: File): Promise<LeadTable> {
  if (file.size > 4_000_000) throw new Error('O arquivo deve ter até 4 MB.');
  if (/\.xlsx$/i.test(file.name)) return parseLeadXlsx(new Uint8Array(await file.arrayBuffer()));
  if (/\.(csv|tsv)$/i.test(file.name)) return parseLeadCsv(await file.text());
  throw new Error('Selecione CSV, TSV ou Excel (.xlsx). Exporte arquivos .xls como CSV ou .xlsx.');
}
export function mapLeadRows(input: LeadTable, mapping: LeadMapping, fallbackDate: string): LeadRow[] {
  return input.rows.map(row => {
    const values = Object.fromEntries(Object.entries(mapping).filter(([, index]) => index !== undefined && index >= 0).map(([key, index]) => [key, (row[index] ?? '').trim()]));
    let occurredAt = values.occurredAt || fallbackDate;
    const brazilian = occurredAt.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    // A date-only export has no measured hour. Use the start of its local day
    // so importing today's contacts in the morning does not invent a future time.
    if (brazilian) occurredAt = `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}T${brazilian[4] ?? '00'}:${brazilian[5] ?? '00'}:${brazilian[6] ?? '00'}-03:00`;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) occurredAt += 'T00:00:00-03:00';
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(occurredAt)) occurredAt += '-03:00';
    return { name: values.name ?? '', occurredAt, ...Object.fromEntries(['email', 'phone', 'company', 'externalId'].filter(key => values[key]).map(key => [key, values[key]])) };
  });
}
