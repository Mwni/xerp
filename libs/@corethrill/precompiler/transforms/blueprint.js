import esprima from 'esprima'
import { extractBlock, extractImports } from './base.js'

export default function blueprint({code, side}){
	if(side === 'server'){
		return code
	}else if(side === 'client'){
		let content = extractBlock(code, `export +default *`)
		let imports = extractImports(code)
		let client = extractBlock(content, `client *: *`)
		let routes = extractBlock(content, `routes *: *`)
		let routesStruct = esprima.parse(`(${routes})`)
		let routesProps = routesStruct.body[0].expression.properties
		let routesOut = ''

		for(let prop of routesProps){
			if(prop.value.type !== 'Identifier')
				continue

			let value = prop.value.name

			routesOut += `${prop.key.raw}: ${value},\n`
		}

		routesOut = `{${routesOut}}`

		return `${imports}\nexport default {routes: ${routesOut}, client: ${client}}`
	}
}