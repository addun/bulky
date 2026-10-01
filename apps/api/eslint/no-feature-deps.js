import path from 'node:path';

/** src/features/<area>/<feature>/... */
const FEATURE = /\/src\/features\/([^/]+)\/([^/]+)\//;

function featureOf(filePath) {
  const match = filePath.replaceAll('\\', '/').match(FEATURE);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

function report(context, source) {
  if (!source || source.type !== 'Literal' || typeof source.value !== 'string') return;
  const specifier = source.value;
  if (!specifier.startsWith('.')) return;

  const importer = context.filename;
  if (!importer || importer === '<input>') return;
  const from = featureOf(importer);
  if (!from) return;

  const resolved = path.resolve(path.dirname(importer), specifier);
  const to = featureOf(resolved);
  if (!to || to === from) return;

  context.report({
    node: source,
    messageId: 'cross',
    data: { from, to },
  });
}

/** A file inside src/features/<area>/<feature>/ cannot import another feature. */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow imports from one feature directory into another.',
    },
    schema: [],
    messages: {
      cross: 'Feature "{{from}}" cannot depend on feature "{{to}}".',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        report(context, node.source);
      },
      ExportAllDeclaration(node) {
        report(context, node.source);
      },
      ExportNamedDeclaration(node) {
        report(context, node.source);
      },
      ImportExpression(node) {
        report(context, node.source);
      },
    };
  },
};

export default rule;
