export function expandMedicalAcronyms(text: string): string {
  if (!text) return '';
  let s = ` ${text.toLowerCase()} `;
  s = s.replace(/\beus[- ]?gbd\b/g, 'eus-guided gallbladder drainage');
  s = s.replace(/\beus[- ]?bd\b/g, 'eus-guided biliary tract drainage');
  s = s.replace(/\beus[- ]?cds\b/g, 'eus-guided choledochoduodenostomy biliary tract drainage');
  s = s.replace(/\beus[- ]?cd\b/g, 'eus-guided choledochoduodenostomy biliary tract drainage');
  s = s.replace(/\beus[- ]?hgs\b/g, 'eus-guided hepaticogastrostomy biliary tract drainage');
  s = s.replace(/\beus[- ]?ge\b/g, 'eus-guided gastroenterostomy');
  s = s.replace(/\beus[- ]?gj\b/g, 'eus-guided gastrojejunostomy');
  s = s.replace(/\beus[- ]?pd\b/g, 'eus-guided pancreatic duct drainage');
  s = s.replace(/\bwon\b/g, 'walled-off necrosis');
  s = s.replace(/\bwopn\b/g, 'walled-off pancreatic necrosis');
  s = s.replace(/\bppc\b/g, 'pancreatic pseudocyst');
  s = s.replace(/\bmbo\b/g, 'malignant biliary obstruction');
  s = s.replace(/\bbbo\b/g, 'benign biliary obstruction');
  s = s.replace(/\blams\b/g, 'lumen-apposing metal stent');
  s = s.replace(/\bec[- ]?lams\b/g, 'electrocautery lumen-apposing metal stent');
  return s.trim();
}
