import { extractBlock, extractBlocks, findEnclosingFunctionName, stripStrings } from './base.js'

const xBlockSignatures = ['@server', '@get', '@post', '@delete']
const xServerDataAccessors = {
	get: `ctx.query['%']`, 
	post: `ctx.request.body['%']`, 
	delete: `ctx.request.body['%']`,
	any: `ctx.query['%'] || ctx.request.body['%']`
}

export default function model({code, side, extensions}){
	let modelCode = extractBlock(code, `export +default +`, false)
	let blocks = discoverXBlocks(code)
	let newCode = ''

	if(!modelCode)
		throw 'could not locate model default export'

	for(let extension of extensions){
		blocks = extension.operator('model-blocks', blocks)
	}

	code = `import { BaseModel } from '@corethrill/core'\n${code.replace(modelCode, '%%%ASSEMBLY%%%')}`

	modelCode = ensureBaseModelExtend(modelCode)

	let clientCode = buildForClient(blocks, modelCode)

	if(side === 'server'){
		newCode = buildForServer(blocks, clientCode)
	}else if(side === 'client'){
		newCode = `${clientCode}`
	}

	return code.replace('%%%ASSEMBLY%%%', newCode)
}

function buildForServer(blocks, clientCode){
	let instantiateCode = null
	let routeBlocks = []

	for(let block of blocks){
		if(block.signature === '@server'){
			instantiateCode = block.code.replace(block.signature, `async function(ctx)`)

			for(let xVar of block.vars){
				instantiateCode = instantiateCode.replace(
					new RegExp(xVar.signature, 'g'),
					xServerDataAccessors.any.replace(/\%/g, xVar.key)
				)
			}
		}else{
			let handlerCode = block.code.replace(block.signature, `async function(ctx)`)

			for(let xVar of block.vars){
				handlerCode = handlerCode.replace(
					new RegExp(xVar.signature, 'g'),
					xServerDataAccessors[block.method].replace(/\%/g, xVar.key)
				)
			}

			let routeBlock = `{path: '${block.name}', method: '${block.method}', handler: ${handlerCode}}`

			routeBlocks.push(routeBlock)
		}
	}

	let routesCode = `[${routeBlocks.join(', ')}]`

	return `${clientCode.slice(0, -1)}\nstatic server = {instantiate: ${instantiateCode}, routes: ${routesCode}}\n}`
}

function buildForClient(blocks, source){
	let persistentVars = derivePersistentXVars(blocks)

	for(let block of blocks){
		source = source.replace(
			block.originalCode, 
			block.clientTemplate.replace('%', transformForClient(block, persistentVars))
		)
	}

	return source.replace(/export +default +/, '')
}

function transformForClient(block, persistentVars){
	if(block.signature === '@server'){
		return ''
	}else{
		let dataMap = {}
		let dataCode = ''

		for(let xVar of persistentVars){
			dataMap[xVar.key] = xVar.accessor
		}

		for(let xVar of block.vars){
			dataMap[xVar.key] = xVar.accessor
		}

		dataCode = Object.entries(dataMap)
			.map(([k, v]) => `'${k}': ${v}`)
			.join(', ')

		dataCode = `{${dataCode}}`


		return `await this.api.${block.method}('${block.name}', ${dataCode})`
	}
}


function ensureBaseModelExtend(code){
	let regex = /class[a-zA-Z0-9_\s]*\{/g
	let match = regex.exec(code)

	if(!match[0].includes(' extends ')){
		code = code.replace(/class[a-zA-Z0-9_\s]*\{/g, `class extends BaseModel{`)

		let constructorCode = extractBlock(code, 'constructor *')


		if(constructorCode){
			code = code.replace(
				constructorCode, 
				constructorCode.replace(`{`, `{\nsuper()\n`)
			)
		}
	}

	return code
}

function discoverXBlocks(code){
	let xBlocks = []

	for(let signature of xBlockSignatures){
		xBlocks = [
			...xBlocks,
			...extractBlocks(code, `${signature} *`, true)
				.map(block => ({
					signature, 
					code: block, 
					originalCode: block,
					clientTemplate: '%',
					method: signature.slice(1),
					vars: discoverXVars(block.slice(signature.length)),
					index: code.indexOf(block),
					name: findEnclosingFunctionName(code, code.indexOf(block))
				}))
		]
	}

	return xBlocks
}

function discoverXVars(code){
	let regex = /@[a-zA-Z_\.]+/g
	let vars = []

	code = stripStrings(code)

	while(true){
		let match = regex.exec(code)

		if(!match)
			break

		vars.push({
			signature: match[0],
			key: match[0].slice(1).replace(/^this/, ''),
			accessor: match[0].slice(1),
			start: match.index,
			end: match.index + match[0].length
		})
	}

	return vars
}

function derivePersistentXVars(blocks){
	let persistent = []

	for(let block of blocks.filter(b => b.method === 'server')){
		persistent.push(...block.vars)
	}

	return persistent
}

model.is = code => xBlockSignatures
	.some(keyword => new RegExp(`( |\t)+${keyword}`, 'g').test(code))