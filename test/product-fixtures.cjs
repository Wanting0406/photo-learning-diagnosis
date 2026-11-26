const { PRODUCT_CAPABILITIES, PRODUCT_SOURCE, capabilityCategory } = require('../server/modules/diagnosis-gateway/diagnosis-product-library');
const { parseCapability, productTableId } = require('../server/modules/diagnosis-gateway/product-capability-catalog');
const productRows = PRODUCT_CAPABILITIES.map(c => ({ recordId: 'rec' + c.id.replace(/-/gu, ''), fields: {
  '产品能力ID': c.id, '产品名称': c.name, '类别': capabilityCategory(c), '问题场景': c.trigger, '作用说明': c.sequence,
  '验收标准': c.acceptance, '使用边界': c.boundary, '启用状态': '启用', '适用年级': '全部',
  '适用学段': c.stage ? [c.stage] : c.id === 'CAP-COURSE-05' ? ['初中', '高中'] : ['小学', '初中', '高中'],
  '适用学科': c.subjects || ['全部'], '来源链接': PRODUCT_SOURCE,
} }));
const productCapabilities = productRows.map(parseCapability);
module.exports = { productRows, productCapabilities, productTableId };
