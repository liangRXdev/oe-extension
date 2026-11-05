import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Unlike the other tests, this loads the real src/formulary.js (a classic
// script that only exposes globalThis.OEFormulary) instead of a copy.
const source = readFileSync(
  fileURLToPath(new URL("../src/formulary.js", import.meta.url)),
  "utf8"
);
const context = { TextDecoder, DecompressionStream, Blob, Response, URL, URLSearchParams };
vm.createContext(context);
vm.runInContext(source, context);
const F = context.OEFormulary;

const plain = (value) => JSON.parse(JSON.stringify(value));
const names = (items) => plain(items.map((item) => item.name));

// --- CSV parsing --------------------------------------------------------

assert.deepEqual(
  plain(F.parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n"multi\nline",z')),
  [
    ["a", "b"],
    ["x, y", 'say "hi"'],
    ["multi\nline", "z"],
  ]
);

// Big5 bytes for "藥名" fall back from UTF-8 to Big5.
assert.equal(F.decodeText(new Uint8Array([0xc3, 0xc4, 0xa6, 0x57]).buffer), "藥名");
assert.equal(F.decodeText(new TextEncoder().encode("藥名").buffer), "藥名");

// --- column detection ---------------------------------------------------

const csv = [
  "院內清單 2026/11",
  "批價碼,藥名,P1儲位,P2儲位,藥庫, 健保價 , 自費價 ,ATC碼,藥理代碼,劑型",
  "OROSU,Rosuvastatin (Crestor) 冠脂妥 10mg/tab,T08,  ,E161,10,12,C10AA07,DN203 ,O",
  "OPAXL,Paxlovid(Nirmatrelvir/Ritonavir) 300/100mg,,,,0,0,XCOVID0,KL002,O",
  ",,,,,,,,,",
].join("\n");
const parsedCsv = F.rowsToFormulary(F.parseCsv(csv));
assert.equal(parsedCsv.items.length, 2);
assert.deepEqual(plain(parsedCsv.missingColumns), ["enName", "ingredient"]);
assert.deepEqual(plain(parsedCsv.items[0]), {
  code: "OROSU",
  name: "Rosuvastatin (Crestor) 冠脂妥 10mg/tab",
  atc: "C10AA07",
  pharm: "DN203",
  form: "O",
  nhiPrice: "10",
  selfPrice: "12",
  locations: [
    ["P1儲位", "T08"],
    ["藥庫", "E161"],
  ],
});
// Pseudo ATC codes are dropped rather than used for grouping.
assert.equal(parsedCsv.items[1].atc, undefined);
assert.equal(parsedCsv.withAtc, 1);

assert.throws(() => F.rowsToFormulary([["foo", "bar"]]), /藥名/);

// --- ATC helpers --------------------------------------------------------

assert.equal(F.normalizeAtc(" c10aa07 "), "C10AA07");
assert.equal(F.normalizeAtc("XCOVID0"), "");
assert.equal(F.atcClassOf("C10AA07"), "C10AA");
assert.equal(F.atcClassOf("G04BC"), "G04BC");
assert.equal(F.atcClassOf("B05"), "");
assert.equal(F.formLabel("O"), "口服");
assert.equal(F.formLabel("H"), "H");

// --- XLSX parsing (synthetic fixture; header on row 2, title row above) --

const xlsx = readFileSync(fileURLToPath(new URL("./fixtures/formulary-sample.xlsx", import.meta.url)));
const parsed = await F.parseFormularyFile(
  "formulary-sample.xlsx",
  xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength)
);
assert.equal(parsed.items.length, 10);
assert.deepEqual(plain(parsed.missingColumns), ["enName", "ingredient"]);
assert.equal(parsed.items[0].code, "OROSU");
assert.equal(parsed.items[0].nhiPrice, "10");
assert.deepEqual(plain(parsed.items[0].locations), [
  ["P1儲位", "T01"],
  ["藥庫", "E001"],
]);
// XML entities in shared strings are unescaped.
assert.equal(parsed.items[9].name, "Glycerin & Water <topical> 500gm/bt");
assert.equal(parsed.items[9].atc, undefined);

// --- lookup -------------------------------------------------------------

const index = F.createIndex(parsed.items);

// Generic name: direct hit, plus the other statin as same-mechanism.
let result = F.lookup(index, "rosuvastatin");
assert.deepEqual(names(result.direct), ["Rosuvastatin (Crestor) 冠脂妥 10mg/tab"]);
assert.deepEqual(plain(result.classes.map((group) => group.atcClass)), ["C10AA"]);
assert.deepEqual(names(result.classes[0].items), ["Atorvastatin (Tulip) 妥寧 40 mg/tab"]);

// Brand name in Chinese, billing code, and a partial brand name.
assert.deepEqual(names(F.lookup(index, "冠脂妥").direct), ["Rosuvastatin (Crestor) 冠脂妥 10mg/tab"]);
assert.deepEqual(names(F.lookup(index, "oator40").direct), ["Atorvastatin (Tulip) 妥寧 40 mg/tab"]);
assert.deepEqual(names(F.lookup(index, "crest").direct), ["Rosuvastatin (Crestor) 冠脂妥 10mg/tab"]);

// Single-ingredient product sorts before the combination that contains it.
assert.deepEqual(names(F.lookup(index, "Atorvastatin 40 mg daily").direct), [
  "Atorvastatin (Tulip) 妥寧 40 mg/tab",
  "Atozet (Ezetimibe/Atorvastatin) 優泰脂 10/20 mg/tab",
]);

// Several drugs in one sentence; Tall Man lettering is case-insensitive.
result = F.lookup(index, "Patients on metformin and dapagliflozin had fewer events");
assert.deepEqual(names(result.direct).sort(), [
  "Dapagliflozin (Forxiga) 福適佳 10mg/tab",
  "MetFORMIN (Ankomin) 美克糖 500 mg/tab",
]);

// Calcium gluconate and carbonate share ATC class A12AA.
result = F.lookup(index, "calcium gluconate");
assert.deepEqual(names(result.direct), ["Calcium Gluconate 鈣克康 10ml/amp"]);
assert.deepEqual(names(result.classes[0].items), ["Calcium Carbonate 500mg/tab 碳酸鈣"]);

// Not stocked: nothing direct, nothing related.
result = F.lookup(index, "empagliflozin");
assert.deepEqual(plain(result), { query: "empagliflozin", direct: [], sameIngredient: [], classes: [] });

// Same ATC (7 chars) is listed as same ingredient, not as same class.
const dupIndex = F.createIndex([
  ...parsed.items,
  { code: "OROSU5", name: "Rosuvas 5mg/tab", atc: "C10AA07" },
]);
result = F.lookup(dupIndex, "rosuvastatin");
assert.deepEqual(names(result.sameIngredient), ["Rosuvas 5mg/tab"]);
assert.deepEqual(names(result.classes[0].items), ["Atorvastatin (Tulip) 妥寧 40 mg/tab"]);

// Empty inputs.
assert.deepEqual(plain(F.lookup(index, "  ").direct), []);
assert.deepEqual(plain(F.lookup(F.createIndex([]), "rosuvastatin").direct), []);


// --- fork: hospital list columns (中文品名 / 英文品名 / 成分 / ATC) -------

// Shape of the TFDA-joined hospital export: CODE, licence, ATC, note, English
// name, ingredients, category, Chinese name. Devices without names are skipped.
const hospitalCsv = [
  "CODE,(沒有資料行名稱),ATC,ATC備註,英文品名,成分,類別,中文品名",
  'OPAX20,衛署藥輸字第000001,N06AB05,,"SEROXAT F.C. TABLETS 20MG",PAROXETINE HYDROCHLORIDE,藥品,克憂果膜衣錠20毫克',
  "IKCL2,衛署藥製字第000002,B05XA01,,K.C.L. INJECTION,POTASSIUM CHLORIDE,藥品,氯化鉀注射液",
  "ODUOT,衛署藥輸字第000003,S01ED51,,DUOTRAV eye drops,TRAVOPROST;;TIMOLOL,藥品,速脈眼藥水",
  "OTIMO,衛署藥輸字第000004,S01ED01,,TIMOPTOL EYE DROPS 0.5%,TIMOLOL MALEATE,藥品,青眼露點眼液",
  "OFLUO,衛署藥製字第000005,N06AB03,,FLUOXETINE CAPSULES 20MG,FLUOXETINE HYDROCHLORIDE,藥品,",
  "OMULTI,衛署藥製字第000006,,多個ATC，需人工確認,PEICHIA TABLETS,ALUMINIUM;;MAGNESIUM,藥品,胃寧錠",
  "800175,衛署醫器輸字第000007,,醫材,,,醫材,",
].join("\n");
const hospital = F.rowsToFormulary(F.parseCsv(hospitalCsv));
assert.equal(hospital.items.length, 6, "device row without any name is skipped");
assert.equal(hospital.withAtc, 5, "multi-ATC cell ('A02AB;A02AX' or blank) is not used for grouping");
assert.deepEqual(plain(hospital.items[0]), {
  code: "OPAX20",
  name: "克憂果膜衣錠20毫克",
  enName: "SEROXAT F.C. TABLETS 20MG",
  ingredient: "PAROXETINE HYDROCHLORIDE",
  atc: "N06AB05",
});
// No Chinese name: the English name becomes the display name.
assert.equal(hospital.items[4].name, "FLUOXETINE CAPSULES 20MG");
assert.equal(hospital.items[4].enName, undefined);

const hIndex = F.createIndex(hospital.items);
// Ingredient (generic) name finds the brand-named in-house product...
result = F.lookup(hIndex, "paroxetine");
assert.deepEqual(names(result.direct), ["克憂果膜衣錠20毫克"]);
// ...and lists the other N06AB (SSRI) item, flagged by class only.
assert.deepEqual(plain(result.classes.map((group) => group.atcClass)), ["N06AB"]);
assert.deepEqual(names(result.classes[0].items), ["FLUOXETINE CAPSULES 20MG"]);
// The salt word alone must not match every hydrochloride.
assert.deepEqual(names(F.lookup(hIndex, "hydrochloride").direct), []);
// English brand, Chinese name and in-house code all hit.
assert.deepEqual(names(F.lookup(hIndex, "Seroxat").direct), ["克憂果膜衣錠20毫克"]);
assert.deepEqual(names(F.lookup(hIndex, "氯化鉀").direct), ["氯化鉀注射液"]);
assert.deepEqual(names(F.lookup(hIndex, "ikcl2").direct), ["氯化鉀注射液"]);
// A combination ingredient hits both the single and the combo product,
// single-ingredient first.
assert.deepEqual(names(F.lookup(hIndex, "timolol").direct), ["青眼露點眼液", "速脈眼藥水"]);

// "ANTI-HEPARIN" in protamine's licence name does not make it heparin.
const antiIndex = F.createIndex([
  { code: "IHEP", name: "肝素注射液", enName: "HEPARIN LEO", ingredient: "HEPARIN SODIUM", atc: "B01AB01" },
  { code: "IPROT", name: "魚精蛋白注射液", enName: "PROTAMINE 1400 ANTI-HEPARIN IU/ML", ingredient: "Protamine Sulphate", atc: "V03AB14" },
]);
assert.deepEqual(names(F.lookup(antiIndex, "heparin").direct), ["肝素注射液"]);
assert.deepEqual(names(F.lookup(antiIndex, "protamine").direct), ["魚精蛋白注射液"]);

// A header with only an English-name column is accepted.
assert.equal(F.rowsToFormulary(F.parseCsv("code,英文品名\nX1,ASPIRIN 100MG")).items[0].name, "ASPIRIN 100MG");

// Garbage items in storage (no name) don't break the index.
assert.deepEqual(names(F.lookup(F.createIndex([null, {}, { name: "Aspirin" }]), "aspirin").direct), ["Aspirin"]);

console.log("formulary tests passed");
