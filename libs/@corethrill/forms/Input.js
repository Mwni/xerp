import m from '@corethrill/core'
import AutoComplete from './AutoComplete.js'

export default{
	__ctFormsComponent: true,

	oncreate(node){
		let cfg = node.attrs

		if(cfg.autocomplete){
			this.ac = new AutoComplete(node.dom, cfg.autocomplete)
			this.ac.on('fill', term => node.attrs.model.value = term)
		}
	},

	view(node){
		let {model, read, write, ...attrs} = node.attrs
		let cls = attrs.class || null

		read = x => x
		write = x => x

		if(model.valid && attrs.validClass)
			cls = cls ? cls + ' ' + attrs.validClass : attrs.validClass

		return m('input', {
			...attrs,
			value: write(model.value),
			oninput: e => model.setValue(read(e.currentTarget.value)) & model.validate.input(),
			onchange: e => model.validate.change(),
			onkeydown: e => (e.keyCode === 13 && attrs.onenter && attrs.onenter()) || true ,
			class: cls
		})
	}
}