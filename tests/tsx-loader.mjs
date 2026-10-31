// Test-only TSX transformation. No app runtime loader or production dependency.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const root=new URL('../',import.meta.url).href;
registerHooks({
  resolve(specifier,context,next){
    try{return next(specifier,context);}catch(error){
      if(specifier.startsWith('.')&&context.parentURL?.startsWith(root))for(const suffix of ['.ts','.tsx']){try{return next(specifier+suffix,context);}catch{}}
      throw error;
    }
  },
  load(url,context,next){
    if(url.startsWith(root)&&/\.tsx?$/.test(url))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText};
    return next(url,context);
  }
});
