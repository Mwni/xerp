import { c as m, BaseModel } from '@corethrill/core'
import EventEmitter from './EventEmitter.js'

class Field extends EventEmitter{
	constructor(value, cfg){
		super()
		this.cfg = cfg || {}
		this.maxLength = this.cfg.maxLength
		this.initial = value
		this.value = value
		this.validationCache = []
		this.status = {}

		let vcfg = {}

		vcfg.input = this.cfg.input || (str => undefined)
		vcfg.change = this.cfg.change || (str => undefined)
		vcfg.submit = this.cfg.submit || (str => undefined)

		this.validate = {}
		this.validate.input = () => this.validateFunctions([vcfg.input])
		this.validate.change = () => this.validateFunctions([vcfg.input, vcfg.change])
		this.validate.submit = () => this.validateFunctions([vcfg.input, vcfg.change, vcfg.submit])
	}

	setValue(v){
		let ov = this.value

		this.value = v

		if(v !== ov)
			this.emit('input')
	}

	reset(){
		this.setValue(this.initial)
	}

	validateFunctions(funcs){
		let token = Math.random().toString(16).slice(2)

		clearTimeout(this.waitTimeout)

		this.status.valid = false
		this.status.issue = null
		this.token = token

		return funcs.reduce((promise, func, i) => {
			return promise
				.then(() => func(this.value))
				.then(() => {
					this.validationCache[i] = {input: this.value, issue: null}
				})
				.catch(issue => {
					this.validationCache[i] = {input: this.value, issue: issue}
					throw issue
				})

		}, Promise.resolve())
			.then(() => {
				if(token === this.token){
					this.status.issue = null
					this.status.valid = true
				}
			})
			.catch(issue => {
				if(token === this.token){
					this.status.issue = issue
					this.status.valid = false
				}
			})
			.then(() => {
				if(token === this.token){
					m.redraw()
				}
				m.redraw()
			})
	}

	getStatusTags(){
		let tags = []

		if(this.status.issue)
			tags.push('issue')

		if(this.status.valid)
			tags.push('valid')

		return tags
	}
}


export default class Model extends BaseModel{
	constructor(ctx, fields){
		super()
		this.fields = {}
		this.status = {}

		let fieldDef = fields || Object.getPrototypeOf(this).constructor.fields

		for(let [key, def] of Object.entries(fieldDef)){
			this.fields[key] = new Field(def.default || '', def)
			this.fields[key].key = key
			this.fields[key].on('input', () => this.emit('input', key))

			Object.defineProperty(this, key, {
				get: () => this.fields[key].value,
				set: value => this.fields[key].setValue(value)
			})
		}

		this.on('input', () => {
			this.status.valid = false
			this.status.issue = null
		})
	}

	hasField(key){
		return !!this.fields[key]
	}

	getField(key){
		return this.fields[key]
	}

	reset(){
		Object.keys(this.fields).forEach(key => this.fields[key].reset())
	}

	async validate(fields){
		let allValid = true

		await Promise.all(Object.keys(this.fields).map(async key => {
			if(fields && !fields.includes(key))
				return true

			await this.fields[key].validate.submit()

			if(!this.fields[key].status.valid)
				allValid = false
		}))


		this.status.valid = allValid
		
		if(!allValid)
			throw 'not all inputs are valid'
	}

	assign(data){
		if(!data)
			return

		Object.keys(data).forEach(key => {
			this.fields[key].setValue(data[key])
		})
	}

	assignFieldStatus(fields){
		if(!fields)
			return

		for(let [key, status] of Object.entries(fields)){
			if(typeof status === 'string'){
				this.fields[key].status.issue = status
			}else{
				Object.assign(this.fields[key].status, status)
			}
		}
	}

	data(){
		let data = {}

		Object.keys(this.fields).forEach(key => {
			data[key] = this.fields[key].value
		})

		return data
	}
}



/*.then(() => {
	let cache = this.validationCache[i]

	if((!this.cfg || !this.cfg.disableCache) && cache && cache.input === this.value){
		if(cache.issue)
			throw cache.issue
		else
			return
	}

	let ret = func(this.value)

	if(typeof ret === 'object' && ret !== null){
		if(ret.wait){
			return new Promise(resolve => {
				this.waitTimeout = setTimeout(() => resolve(ret.query(this.value)), ret.wait)
			})
		}
	}	
})*/