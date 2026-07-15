import * as t from '@babel/types';

import { ASTParser } from '../astParser';

type FakePath = {
  node: t.Node;
  parentPath?: FakePath | null;
};

describe('ASTParser export detection', () => {
  const parser = new ASTParser() as any;

  it('marks declarations wrapped by an export as exported', () => {
    const exportPath: FakePath = {
      node: t.exportNamedDeclaration(null, []),
      parentPath: null,
    };
    const functionPath: FakePath = {
      node: t.functionDeclaration(t.identifier('publicApi'), [], t.blockStatement([])),
      parentPath: exportPath,
    };

    expect(parser.isExported(functionPath)).toBe(true);
  });

  it('does not inherit export status through an exported function body', () => {
    const exportPath: FakePath = {
      node: t.exportNamedDeclaration(null, []),
      parentPath: null,
    };
    const functionPath: FakePath = {
      node: t.functionDeclaration(t.identifier('publicApi'), [], t.blockStatement([])),
      parentPath: exportPath,
    };
    const blockPath: FakePath = {
      node: t.blockStatement([]),
      parentPath: functionPath,
    };
    const localVariablePath: FakePath = {
      node: t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier('localOnly'), t.stringLiteral('value')),
      ]),
      parentPath: blockPath,
    };

    expect(parser.isExported(localVariablePath)).toBe(false);
  });
});
