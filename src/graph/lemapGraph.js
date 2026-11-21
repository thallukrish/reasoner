import crypto from 'node:crypto';
// Extracted without modification to the graph transforms from DataSong demo_v2/server/explorer/mapPersistence.js (main).
const arr = value => Array.isArray(value) ? value : [];
const clone = value => JSON.parse(JSON.stringify(value));
const identityKey = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const relationObjects = objects => Object.values(objects).filter(object => object?.type === 'relation');
export function normalizeLearnedGraph(graph = []) {
  const source = clone(arr(graph));
  const entityByName = new Map();
  for (const node of source) {
    if (node?.type !== 'entity' || !node?.id || !node?.name) continue;
    const key = identityKey(node.name), prior = entityByName.get(key);
    if (!prior || (!prior?.data?.schemaResolved && node?.data?.schemaResolved)) entityByName.set(key, node);
  }
  const redirects = new Map();
  for (const node of source) {
    if (node?.type !== 'concept' || !node?.id) continue;
    const entity = entityByName.get(identityKey(node.name));
    if (entity) redirects.set(node.id, entity.id);
  }
  const kept = source.filter((node) => node?.id && !redirects.has(node.id));
  const byId = new Map(kept.map((node) => [node.id, node]));
  const ownedFields = new Map();
  for (const node of kept) {
    if (node.type !== 'entity') continue;
    const names = new Set();
    for (const raw of arr(node.links)) {
      if (raw?.relationship !== 'has field') continue;
      const target = byId.get(redirects.get(raw?.nodeId) || raw?.nodeId);
      if (target?.type !== 'field') continue;
      const owner = String(target.data?.sourceEntity || target.data?.entityName || '');
      if (owner && identityKey(owner) !== identityKey(node.name)) continue;
      const fieldName = String(target.data?.physicalFieldName || target.data?.fieldName || target.name?.split('.').at(-1) || '');
      if (fieldName) names.add(identityKey(fieldName));
    }
    ownedFields.set(node.id, names);
  }
  for (const node of kept) {
    const seen = new Set(), links = [];
    for (const raw of arr(node.links)) {
      const nodeId = redirects.get(raw?.nodeId) || raw?.nodeId;
      const target = byId.get(nodeId);
      if (!target) continue;
      const relationship = String(raw?.relationship || 'related to');
      let kind = String(raw?.data?.relationshipKind || '');
      if (kind === 'schema_fk' && target.type !== 'entity') continue;
      if (relationship === 'has field' && node.type === 'entity' && target.type === 'field') {
        const owner = String(target.data?.sourceEntity || target.data?.entityName || '');
        if (owner && identityKey(owner) !== identityKey(node.name)) continue;
      }
      const keyMaps = arr(raw?.data?.keyMaps).map((map) => ({
        fieldName:String(map?.fieldName || ''), relatedFieldName:String(map?.relatedFieldName || ''), implicit:!!map?.implicit
      }));
      const validKeyMaps = keyMaps.length > 0 && target.type === 'entity' && keyMaps.every((map) =>
        ownedFields.get(node.id)?.has(identityKey(map.fieldName)) && ownedFields.get(target.id)?.has(identityKey(map.relatedFieldName))
      );
      if (kind === 'schema_fk' && !validKeyMaps) kind = 'schema_reference';
      const signature = `${nodeId}|${identityKey(relationship)}|${kind}|${JSON.stringify(keyMaps)}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      links.push({ ...raw, nodeId, data:{ ...(raw.data || {}), relationshipKind:kind, ...(keyMaps.length ? { keyMaps } : {}), ...(kind === 'schema_reference' ? { evidenced:false } : {}) } });
    }
    node.links = links;
  }
  const referencedFields = new Set(kept.flatMap((node) => arr(node.links).filter((link) => link.relationship === 'has field').map((link) => link.nodeId)));
  return kept.filter((node) => node.type !== 'field' || referencedFields.has(node.id));
}

export function graphFromSemanticObjects(objects = {}) {
  const linksByNode = new Map();
  for (const relation of relationObjects(objects)) {
    const fromId = relation?.properties?.fromId;
    const toId = relation?.properties?.toId;
    if (!fromId || !toId || !objects[fromId] || !objects[toId]) continue;
    if (!linksByNode.has(fromId)) linksByNode.set(fromId, []);
    linksByNode.get(fromId).push({
      nodeId: toId,
      relationship: relation.properties.relation || relation.name || 'related to',
      cardinality: relation.properties.cardinality || 'unknown',
      data: Object.fromEntries(Object.entries(relation.properties || {}).filter(([key]) => !['fromId', 'toId', 'relation', 'cardinality'].includes(key))),
      confidence: Number(relation.confidence || 0),
      evidence: clone(arr(relation.evidence))
    });
  }
  const graph = Object.values(objects).filter((object) => object?.type !== 'relation').map((object) => ({
    id: object.id,
    type: object.type || 'concept',
    name: object.name || '',
    data: {
      ...(object.properties || {}),
      ...(arr(object.aliases).length ? { aliases: clone(object.aliases) } : {}),
      ...(object.scope ? { scope: object.scope } : {}),
      confidence: Number(object.confidence || 0),
      evidence: clone(arr(object.evidence))
    },
    links: linksByNode.get(object.id) || []
  }));
  return normalizeLearnedGraph(graph);
}

export function semanticObjectsFromGraph(graph = []) {
  const objects = {};
  for (const node of arr(graph)) {
    if (!node?.id) continue;
    const { aliases = [], scope = '', confidence = 0, evidence = [], ...properties } = node.data || {};
    objects[node.id] = {
      id: node.id, type: node.type || 'concept', name: node.name || '', aliases: clone(arr(aliases)), scope,
      properties: clone(properties), evidence: clone(arr(evidence)), confidence: Number(confidence || 0)
    };
  }
  for (const node of arr(graph)) {
    for (const [index, link] of arr(node?.links).entries()) {
      if (!node?.id || !link?.nodeId || !objects[link.nodeId]) continue;
      const relationship = link.relationship || 'related to';
      const id = `relation:${crypto.createHash('sha1').update(`${node.id}|${relationship}|${link.nodeId}|${index}`).digest('hex').slice(0, 16)}`;
      objects[id] = {
        id, type: 'relation', name: `${node.name || node.id} ${relationship} ${objects[link.nodeId].name || link.nodeId}`,
        aliases: [], scope: `${node.id}|${link.nodeId}`,
        properties: { fromId: node.id, toId: link.nodeId, relation: relationship, cardinality: link.cardinality || 'unknown', ...(link.data || {}) },
        evidence: clone(arr(link.evidence)), confidence: Number(link.confidence || 0)
      };
    }
  }
  return objects;
}

export function workflowArcsFromGraph(graph = []) {
  const nodes = new Map(arr(graph).filter((node) => node?.id).map((node) => [node.id, node]));
  const outgoing = (node, relationship) => arr(node?.links).filter((link) => !relationship || link.relationship === relationship).map((link) => nodes.get(link.nodeId)).filter(Boolean);
  return arr(graph).filter((node) => node?.type === 'workflow' && node?.data?.closureState === 'closed').map((workflow) => {
    const data = workflow.data || {};
    const entities = outgoing(workflow, 'uses entity');
    const steps = outgoing(workflow, 'contains step').sort((a, b) => Number(a?.data?.order || 0) - Number(b?.data?.order || 0));
    const callPathEvidence = arr(data.evidence).find((item) => item?.sourceType === 'call_path');
    const entityDetails = entities.map((entity) => ({
      name: entity.name,
      description: entity.data?.description || '',
      schemaResolved: !!entity.data?.schemaResolved,
      schemaName: entity.data?.schemaName || '',
      schemaSourcePath: entity.data?.schemaSourcePath || '',
      schemaComponent: entity.data?.schemaComponent || '',
      representedBy: clone(arr(entity.data?.representedBy)),
      fields: outgoing(entity, 'has field').map((field) => ({
        name: field.data?.fieldName || field.name,
        type: field.data?.dataType || '',
        isPk: !!field.data?.isPk,
        description: field.data?.description || '',
        sourceEntity: field.data?.sourceEntity || '',
        physicalFieldName: field.data?.physicalFieldName || ''
      }))
    }));
    const relationshipDetails = entities.flatMap((entity) => arr(entity.links)
      .filter((link) => !['has field'].includes(link.relationship) && nodes.get(link.nodeId)?.type === 'entity')
      .map((link) => ({ from: entity.name, relation: link.relationship, to: nodes.get(link.nodeId)?.name || '', description: link.data?.description || '' })));
    return {
      id: data.arcId || workflow.id,
      title: workflow.name,
      businessActor: data.actor || '',
      businessIntent: data.intent || '',
      trigger: data.trigger || '',
      outcome: data.outcome || '',
      businessOutcome: data.outcome || '',
      closureState: data.closureState || 'closed',
      progress: Number(data.progress ?? 100),
      status: 'broadly_complete',
      entities: entities.map((entity) => entity.name),
      entityDetails,
      workflowSteps: steps.map((step) => ({
        name: step.name,
        description: step.data?.description || '',
        effect: step.data?.effect || '',
        sourcePath: step.data?.sourcePath || '',
        entities: outgoing(step, 'touches entity').map((entity) => entity.name),
        persistentObjects: []
      })),
      relationshipDetails,
      relationships: relationshipDetails.map((item) => [item.from, item.relation, item.to].filter(Boolean).join(' → ')),
      traceability: callPathEvidence?.provenance || null,
      callPathId: callPathEvidence?.provenance?.callPathId || callPathEvidence?.source || ''
    };
  });
}

