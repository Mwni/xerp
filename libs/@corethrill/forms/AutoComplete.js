import EventEmitter from './EventEmitter.js'

export default class AutoComplete extends EventEmitter{
	constructor(input, cfg){
		super()
		this.input = input
		this.provider = cfg.provider
		this.wait = cfg.wait || 100
		this.minLength = typeof cfg.minLength === 'number' ? cfg.minLength : 2
		this.customElementRenderer = cfg.renderElement
		this.fillTranslator = cfg.fill
		this.alwaysOpen = !!cfg.alwaysOpen
		this.index = -1
		this.list = []

		if(cfg.prefetchFilled)
			this.fetch()

		this.container = document.createElement('div')
		this.container.classList.add('autocomplete')
		this.container.style.display = 'none'
		this.input.parentNode.appendChild(this.container)

		this.input.setAttribute('autocomplete', 'off')

		this.input.addEventListener('input', () => this.onInput())
		this.input.addEventListener('keydown', e => this.onKey(e.keyCode))
		this.input.addEventListener('focus', e => this.onFocus())
		this.input.addEventListener('blur', e => this.onBlur())
	}

	onInput(){
		if(this.input.value.length < this.minLength){
			this.update([])
			return
		}

		clearTimeout(this.timeout)
		this.timeout = setTimeout(() => this.fetch(), this.wait)

		this.index = -1
		this.render()
	}

	onKey(code){
		if(this.list.length === 0)
			return

		switch(code){
			case 40:
				this.select(this.index + 1)
				break
			case 38:
				this.select(this.index - 1)
				setCaretPosition(this.input, this.input.value.length)
				break
			case 13:
				this.select(this.index)
				this.fill()
				break
		}
	}

	onFocus(){
		this.focused = true
		this.render()

		this.mousedownHandler = e => {
			this.keepOpen = this.container.contains(e.target)
		}

		window.addEventListener('mousedown', this.mousedownHandler)
	}

	onBlur(){
		if(this.ignoreBlur)
			return

		this.focused = false

		if(!this.keepOpen)
			this.render()

		window.removeEventListener('mousedown', this.mousedownHandler)
	}

	fill(){
		if(this.list.length === 0 || !this.list[this.index])
			return

		let str = this.list[this.index]
		
		this.input.value = this.fillTranslator ? this.fillTranslator(str) : str
		this.index = -1
		this.list = []
		this.keepOpen = false
		this.render()

		this.emit('fill', str)
	}

	fetch(){
		if(this.input.value.length < this.minLength)
			return

		this.provider(this.input.value)
			.then(list => this.update(list))
	}

	update(list){
		this.list = list
		this.render()
	}

	select(i){
		if(this.list.length === 0)
			return

		if(i === this.index)
			return

		i = Math.max(0, i)
		i = Math.min(this.list.length - 1, i)

		this.index = i
		this.render()
	}

	render(){
		let visible = (this.list.length > 0 && this.focused) || this.keepOpen || this.alwaysOpen

		this.container.style.display = visible ? '' : 'none'
		this.container.innerHTML = ''

		this.list.forEach((e, i) => {
			this.container.appendChild(this.createElement(e, i, i === this.index))
		})

		this.emit('render')
	}

	createElement(e, i, a){
		let element

		if(this.customElementRenderer){
			element = this.customElementRenderer(e)
		}else{
			element = document.createElement('label')
			element.textContent = e
		}

		element.addEventListener('mouseover', () => this.select(i))
		element.addEventListener('mousedown', () => this.emit('probably-will-fill'))
		element.addEventListener('click', () => this.select(i) & this.fill())

		if(a)
			element.classList.add('selected')

		return element
	}
}