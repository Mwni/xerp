import Model from './Model.js'
import Form from './Form.js'
import Input from './Input.js'
//import Date from './Date.js'
import Radio from './Radio.js'
import Select from './Select.js'
import Code from './Code.js'
import Status from './Status.js'
import MaxLengthIndicator from './MaxLengthIndicator.js'


export { Model, Form, Input, /*Date,*/ Radio, Select, Code, Status, MaxLengthIndicator }


/*import m from '@corethrill/core'
import AutoComplete from './AutoComplete.js'

class Form{
	view(node){
		return m(
			'form', 
			{
				class: node.attrs.class,
				onsubmit: e => {
					e.preventDefault()

					node.attrs.model.validate()
						.then(() => node.attrs.submit.callback())
				}
			},
			node.children.concat([
				node.attrs.model.issue ? m('span.issue', node.attrs.model.issue) : null,
				m(
					'button.generic' + (node.attrs.submit.class ? ' ' + node.attrs.submit.class : ''), 
					{class: node.attrs.model.busy ? 'busy loading' : null}, 
					m('span', node.attrs.submit.label)
				)
			])
		)
	}
}


class FieldSet{
	view(node){
		let children = node.attrs.fields.map(f => {
			if(!f)
				return null

			return m(
				Field,
				{
					model: node.attrs.model.fields[f.key], 
					cfg: f, 
					disabled: node.attrs.disabled || node.attrs.model.busy
				}
			)
		})

		return m('div', {class: node.attrs.class}, children)
	}
}


class Field{
	view(node){
		let model = node.attrs.model
		let cfg = node.attrs
		let reverse = false
		let xid = Math.random().toString(32).slice(2)

		let children = [
			m('label', {for: xid}, [cfg.label, cfg.labelWidget ? m(cfg.labelWidget) : null]),
			m('div', [
				m(Input, Object.assign({xid}, node.attrs)),
				cfg.maxLength && cfg.indicateMaxLength ? m(MaxLengthIndicator, {
					value: model.value,
					max: cfg.maxLength
				}) : null,
				model.issue ? m('span.issue', model.issue) : null
			])
		]

		if(cfg.reverse)
			reverse = !reverse

		if(reverse)
			children.reverse()


		return m(
			'div.field.'+cfg.type, 
			{classes: [
				model.issue ? 'invalid' : null,
				cfg.disabled ? 'disabled' : null
			]}, 
			children
		)
	}
}

class Input{
	oncreate(node){
		let cfg = node.attrs

		if(cfg.autocomplete){
			this.ac = new AutoComplete(node.dom, cfg.autocomplete)
			this.ac.on('fill', term => node.attrs.model.value = term)
		}
	}

	onupdate(node){
		if(node.attrs.autoResize){
			let textarea = node.dom

			Promise.resolve()
				.then(() => {
					textarea.style.height = ''
					textarea.style.height = Math.max(
						node.attrs.autoResize.minHeight || 0,
						Math.min(
							node.attrs.autoResize.maxHeight || 99999,
							textarea.scrollHeight+3
						)
					) + 'px'
				})
		}
	}

	view(node){
		let model = node.attrs.model
		let cfg = node.attrs
		let read = cfg.read || (v => v)
		let write = cfg.write || (v => v)
		let input = null
		let xid = node.attrs.xid
		let cls = cfg.class || null

		if(model.valid && cfg.validClass)
			cls = cls ? cls + ' ' + cfg.validClass : cfg.validClass

		switch(cfg.type){
			case 'select':
				input = m('select', 
					{
						id: xid,
						onchange: e => model.setValue(read(cfg.options[e.currentTarget.selectedIndex].value)) & model.validate.change(),
						disabled: node.attrs.disabled
					},
					cfg.options.map(opt => m('option', {value: opt.value, selected: opt.value === write(model.value), disabled: opt.disabled}, opt.name))
				)
				break

			case 'checkbox':
				input = m('input', {
					id: xid,
					type: 'checkbox',
					checked: !!write(model.value),
					onchange: e => model.setValue(read(e.currentTarget.checked)),
					disabled: node.attrs.disabled,
					class: cls
				})
				break

			case 'module':
				input = m(cfg.module, Object.assign({}, cfg.attrs || {}, {
					id: xid,
					value: write(model.value),
					onchange: v => model.setValue(read(v)) & model.validate.change(),
					onissue: issue => {
						model.issue = issue
						m.redraw()
					},
					disabled: node.attrs.disabled,
					class: cls
				}))
				break

			case 'textarea':
				input = m('textarea', Object.assign({
					id: xid,
					value: write(model.value),
					oninput: e => model.setValue(read(e.currentTarget.value)) & model.validate.input(),
					onchange: e => model.validate.change(),
					disabled: node.attrs.disabled,
					placeholder: cfg.placeholder,
					maxLength: cfg.maxLength,
					class: cls
				}, cfg.attrs || {}))
				break

			default:
				input = m('input', {
					id: xid,
					type: cfg.type, 
					value: write(model.value),
					oninput: e => model.setValue(read(e.currentTarget.value)) & model.validate.input(),
					onchange: e => model.validate.change(),
					onkeydown: e => (e.keyCode === 13 && cfg.onenter && cfg.onenter()) || true ,
					disabled: node.attrs.disabled,
					placeholder: cfg.placeholder,
					maxlength: cfg.maxLength,
					class: cls
				})
				break
		}

		return input
	}
}

class MaxLengthIndicator{
	view(node){
		if(node.attrs.value)
			return m('span.max', node.attrs.value.length + ' / ' + node.attrs.max)
		else
			return m('span')
	}
}

class AutoFocusInput{
	oncreate(node){
		node.dom.focus()
	}

	view(node){
		return m('input', node.attrs)
	}
}


export default { Model, ModelSet, Form, FieldSet, Field, Input, AutoFocusInput }
*/