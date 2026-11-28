import ts from 'typescript';
import { noteCopyId, summaryCopyId, validateReleaseHistory } from '../../src/domain/release-history/release-history.ts';

/** Scan only known display fields in the one allowlisted JSON source. */
export function scanReleaseHistory(source) {
  validateReleaseHistory(JSON.parse(source));
  const file = ts.parseJsonText('release-history.json', source);
  if (file.parseDiagnostics.length) throw new Error('Invalid release history JSON');
  const fields = node => {
    if (!node || !ts.isObjectLiteralExpression(node)) throw new Error('Invalid release history object');
    const result = new Map();
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name) || result.has(property.name.text)) throw new Error('Duplicate or invalid release field');
      result.set(property.name.text, property.initializer);
    }
    return result;
  };
  const entries = [];
  const add = (node, id, context) => {
    if (!node || !ts.isStringLiteral(node)) throw new Error('Invalid release history text');
    entries.push({ kind: 'release-history-text', annotationId: id, text: node.text, context,
      ordinal: entries.length, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      start: node.getStart(file), end: node.end });
  };
  const root = fields(file.statements[0].expression);
  for (const release of root.get('releases').elements) {
    const record = fields(release), id = record.get('id').text;
    const context = id;
    const notes = record.get('user_notes');
    if (notes.kind !== ts.SyntaxKind.NullKeyword) {
      const user = fields(notes);
      add(user.get('summary'), summaryCopyId(id), context);
      for (const group of ['features', 'improvements', 'fixes']) for (const note of user.get(group).elements) {
        const data = fields(note); add(data.get('text'), noteCopyId(id, data.get('id').text), context);
      }
    }
    for (const note of record.get('technical_notes').elements) {
      const data = fields(note); add(data.get('text'), noteCopyId(id, data.get('id').text), context);
    }
  }
  return { entries, excluded: [], needsReview: [] };
}
