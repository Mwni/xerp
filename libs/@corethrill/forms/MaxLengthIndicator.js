import m from '@corethrill/core'

export default {
	view: node =>{
		let model = node.attrs.model

		if(model.value || !node.attrs.hideEmpty)
			return m('span.max', model.value.length + ' / ' + model.maxLength)
		else
			return m('span.max.empty')
	}
}