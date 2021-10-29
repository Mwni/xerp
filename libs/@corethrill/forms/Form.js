import m from '@corethrill/core'
import Input from './Input.js'

export default node => {
	let submitting = false
	let presentFields = []

	async function submit(e){
		submitting = true

		try{
			await node.attrs.model.validate(presentFields)

			node.attrs.model.status.submitting = true

			if(node.attrs.action){
				await node.attrs.action.call(node.attrs.model, node.attrs.model.data())
			}else{
				await node.attrs.model.submit()
			}

			if(node.attrs.onsubmit){
				node.attrs.onsubmit()
			}
		}catch(e){
			node.attrs.model.status.valid = false
			node.attrs.model.status.issue = e.message
		}finally{
			submitting = false
			node.attrs.model.status.submitting = false
			node.ctx.redraw()
		}

		return false
	}

	return {
		view: node => {
			let model = node.attrs.model
			let disabled = node.attrs.disabled || submitting
			let children = node.children

			presentFields = []

			walkChildren(children, child => {
				if(child.tag === 'button'){
					if(!child.attrs.type)
						child.attrs.type = 'button'

					if(!child.attrs.hasOwnProperty('disabled')){
						child.attrs.disabled = disabled
					}
				}

				if(child.attrs && child.attrs.field){
					if(!model.hasField(child.attrs.field)){
						console.warn(`missing field "${child.attrs.field}" in model`)
						return
					}

					let field = model.getField(child.attrs.field)

					if(child.tag === 'input' && child.attrs.type === 'checkbox'){
						child.attrs.checked = !!field.value
						child.attrs.onchange = e => field.setValue(e.target.checked) & field.validate.change()
					}else{
						child.attrs[child.tag.valueKey || 'value'] = field.value
						child.attrs.oninput = e => field.setValue(e.target.value) & field.validate.input()
						child.attrs.onchange = e => field.setValue(e.target.value) & field.validate.change()
						child.attrs.maxlength = field.maxLength
					}
					

					if(child.attrs.className){
						child.attrs.className = child.attrs.className.replace('$status', field.getStatusTags().join(' '))
					}

					if(child.attrs.class){
						child.attrs.class = child.attrs.class.replace('$status', field.getStatusTags().join(' '))
					}
					
					if(child.attrs.onenter){
						child.attrs.onkeydown = e => ((e.keyCode === 13 && child.attrs.onenter()), true)
					}

					if(typeof child.tag === 'object')
						child.attrs.model = field

					if(disabled){
						child.attrs.disabled = true
					}

					presentFields.push(child.attrs.field)
				}else{
					if(typeof child.tag === 'object')
						child.attrs.model = model
				}
			})

			return m(
				'form',
				{
					class: node.attrs.class,
					onsubmit: e => !disabled && submit(e) && false, 
				},
				children
			)
		}
	}
}

function walkChildren(children, func){
	if(!children)
		return

	for(let child of children){
		if(!child)
			continue
			
		func(child)
		walkChildren(child.children, func)
	}
}