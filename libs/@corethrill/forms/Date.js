import m from '@corethrill/core'
import { Datepicker, DateRangePicker } from 'vanillajs-datepicker';

const DateComponent = {
	oncreate(node){
		node.state.datepicker = new Datepicker(node.dom, {
			format: node.attrs.format,
			minDate: node.attrs.minDate,
			weekStart: 1
		})

		if(node.attrs.value)
			node.state.datepicker.setDate(node.attrs.value)

		node.dom.addEventListener('changeDate', () => node.attrs.onchange({target: {value: node.state.datepicker.getDate()}}))
	},

	view(node){
		let {format, value, ...attrs} = node.attrs
		let cls = attrs.class || null

		return m('input', {
			...attrs,
			type: 'text',
			class: cls
		})
	}
}

DateComponent.Range = {
	async oncreate(node){
		await Promise.resolve()

		node.dom.addEventListener('changeDate', e => {
			let dates = e.detail.datepicker.rangepicker.getDates()

			if(dates[1])
				node.attrs.onchange({target: {value: dates}})
		})

		if(!node.attrs.start)
			return

		let otherInput = document.querySelector(`[name=${node.attrs.field}]`)


		node.state.datepicker = new DateRangePicker(node.dom, {
			inputs: [node.dom, otherInput],
			format: node.attrs.format,
			minDate: node.attrs.minDate,
			weekStart: 1
		})

		if(node.attrs.value){
			node.state.datepicker.setDates(...node.attrs.value)
		}
	},

	view(node){
		let {format, value, field, start, end, ...attrs} = node.attrs
		let cls = attrs.class || null

		return m('input', {
			...attrs,
			name: end ? field : null,
			type: 'text',
			class: cls
		})
	}
}


export default DateComponent