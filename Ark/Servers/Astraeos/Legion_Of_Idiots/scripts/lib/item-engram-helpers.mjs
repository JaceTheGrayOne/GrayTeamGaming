function splitDelimited(value) {
  return String(value || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function withoutGeneratedSuffix(value) {
  return String(value || '').trim().replace(/_C$/i, '');
}

function itemStemFromClassName(className) {
  return withoutGeneratedSuffix(className)
    .replace(/^PrimalItemStructure_?/i, '')
    .replace(/^PrimalItemArmor_?/i, '')
    .replace(/^PrimalItemWeapon_?/i, '')
    .replace(/^PrimalItemAmmo_?/i, '')
    .replace(/^PrimalItemConsumable_?/i, '')
    .replace(/^PrimalItemResource_?/i, '')
    .replace(/^PrimalItemSkin_?/i, '')
    .replace(/^PrimalItem_?/i, '')
    .replace(/^ItemStructure_?/i, '')
    .replace(/^Item_?/i, '');
}

function itemStemAliases(stem) {
  const aliases = new Set([stem]);
  const base = String(stem || '');
  if (!base) return [];

  aliases.add(base.replace(/Gateframe/g, 'Gateway'));
  aliases.add(base.replace(/GateFrame/g, 'Gateway'));
  aliases.add(base.replace(/FrameGate/g, 'Gateway'));

  const tekGate = base.match(/^TekGate(_Large)?$/i);
  if (tekGate) aliases.add(`Tek_Gate${tekGate[1] || ''}`);

  const tekGateframe = base.match(/^TekGateframe(_Large)?$/i);
  if (tekGateframe) {
    aliases.add(`Tek_Gateway${tekGateframe[1] || ''}`);
    aliases.add(`Tek_Gateframe${tekGateframe[1] || ''}`);
    aliases.add(`Tek_Gategrame${tekGateframe[1] || ''}`);
  }

  return [...aliases].filter(Boolean);
}

function engramStemFromClassName(className) {
  return withoutGeneratedSuffix(className)
    .replace(/^EngramEntry_?/i, '')
    .replace(/^PrimalEngramEntry_?/i, '')
    .replace(/^PrimalEngram_?/i, '')
    .replace(/^Engram_?/i, '');
}

export function itemEngramStemCandidates(row = {}) {
  const stems = [];
  const classStem = itemStemFromClassName(row.className);
  if (classStem) stems.push(...itemStemAliases(classStem));

  const gfiStem = withoutGeneratedSuffix(row.gfiCode);
  if (gfiStem && gfiStem !== classStem) stems.push(...itemStemAliases(gfiStem));

  return uniq(stems);
}

export function itemEngramClassCandidates(row = {}) {
  const explicit = splitDelimited(row.engramClassName);
  const inferred = itemEngramStemCandidates(row).flatMap((stem) => [
    `EngramEntry_${stem}_C`,
    `PrimalEngramEntry_${stem}_C`,
  ]);
  return uniq([...explicit, ...inferred]);
}

export function normalizedEngramStem(className) {
  return engramStemFromClassName(className).toLowerCase();
}
