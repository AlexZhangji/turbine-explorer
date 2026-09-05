import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {english,translateEnglish as translate} from '../src/translations.ts';
const missing=new Set();
function check(text){if(!/[\p{Script=Han}]/u.test(text))return;const result=translate(text);if(/[\p{Script=Han}]/u.test(result))missing.add(text);}
for(const file of ['src/main.ts','src/component-inspector.ts','src/exhibition.ts']){
  const source=fs.readFileSync(file,'utf8');const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  function visit(node){if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)){if(node.text.includes('<')){for(const match of node.text.matchAll(/>([^<>]+)</g))check(match[1]);}else check(node.text);}ts.forEachChild(node,visit);}visit(ast);
}
for(const match of fs.readFileSync('index.html','utf8').matchAll(/>([^<>]+)</g))check(match[1]);
assert(!Object.values(english).some(value=>/[\p{Script=Han}]/u.test(value)), 'English catalog cannot contain Chinese');
for(const text of ['第2级涡轮动叶环','第3级涡轮动叶环','第4级涡轮动叶环','10 个入口','14 级压气机','4 级涡轮','153.2 kWh 已送出','15.9 kWh / 秒'])assert(!/[\p{Script=Han}]/u.test(translate(text)),`Dynamic translation: ${text}`);
assert.equal(translate('571 MW'),'571 MW','Technical values and units are unchanged');
if(missing.size)console.log('Uncovered authored strings:', [...missing]);
assert.equal(missing.size,0,'Every authored static UI string needs catalog coverage');
console.log('PASS: bilingual catalog covers authored static UI text. Runtime state preservation is checked in the live browser.');
