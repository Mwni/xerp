import m from '@corethrill/core'

export default {
	view: node => {
		let {model, options, placeholder, ...attrs} = node.attrs
		let children = options.map(option => m('option', {value: option.value, selected: option.value === node.attrs.value}, option.label))

		if(placeholder)
			children.unshift(m('option', {hidden: true, value:''}, placeholder))

		return m('select', {...attrs, }, children)
	}
}