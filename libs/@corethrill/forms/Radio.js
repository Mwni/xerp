import m from '@corethrill/core'

export default {
	valueKey: 'active',
	view: node => m('input', {
		...node.attrs, 
		type: 'radio', 
		name: node.attrs.model.key,
		checked: node.attrs.value === node.attrs.active,
		onchange: e => node.attrs.onchange({target: {value: node.attrs.value}})
	})
}