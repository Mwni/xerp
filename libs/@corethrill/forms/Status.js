import m from '@corethrill/core'

export default {
	view: node => {
		let model = node.attrs.model

		if(model.status.issue){
			return m('span.issue', model.status.issue)
		}
	}
}