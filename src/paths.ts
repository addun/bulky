import { join } from 'node:path';
import Module from 'node:module';

const root = __dirname;

function mapRequest(request: string): string {
  if (request === '@app/store') return join(root, 'store');
  if (request.startsWith('@app/store/')) return join(root, 'store', request.slice('@app/store/'.length));
  return request;
}

type ResolveFilename = (
  request: string,
  parent: NodeModule | undefined,
  isMain: boolean,
  options?: object,
) => string;

const loader = Module as unknown as { _resolveFilename: ResolveFilename };
const original = loader._resolveFilename.bind(Module);
loader._resolveFilename = function (request, parent, isMain, options) {
  return original(mapRequest(request), parent, isMain, options);
};
