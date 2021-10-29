import m from '@corethrill/core'

export default node => {
	let code = node.attrs.value || ''
	let inputs = []

	async function ensureFocus(){
		await new Promise(resolve => setTimeout(resolve, 10))

		inputs[Math.min(code.length, inputs.length-1)].focus()
	}

	function handleInput(){
		code = inputs.reduce((code, input) => code + input.value, '')

		node.attrs.oninput({target: {value: code}})

		ensureFocus()
	}

	function handleKey(e){
		if(e.keyCode === 8){
			code = code.slice(0, -1)
			ensureFocus()
		}

		return true
	}

	return {
		oncreate: node => {
			inputs = Array.from(node.dom.querySelectorAll('input'))
		},
		view: node => m('div.code', [
			Array(node.attrs.length).fill(0).map((x, i) => m(
				'input',
				{
					type: 'text',
					maxlength: 1,
					value: code.charAt(i),
					onfocus: ensureFocus,
					oninput: handleInput,
					onkeydown: handleKey
				}
			))
		])
	}
}