import parseImports from 'parse-es6-imports'

export default [
	{
		todo: (code, file) => {
			if(!code.includes('@corethrill/forms'))
				return null

			let imports = parseImports(code)
			let namedModel = null

			for(let imp of imports){
				if(imp.fromModule === '@corethrill/forms'){
					namedModel = imp.namedImports.find(i => i.name === 'Model')?.value

					if(namedModel)
						break
				}
			}

			if(!namedModel)
				return null

			let modelCode = extractBlock(code, `class +[a-zA-Z0-9_]* *extends +${namedModel}`)
			let fieldsCode = extractBlock(modelCode, `( |\t)*static +fields *=`)

			if(!fieldsCode)
				return null

			return {fieldsCode}
		},
		operator: (todo, op, blocks) => {
			if(op !== 'model-blocks' || !todo)
				return blocks

			let modifiedBlocks = []

			for(let block of blocks){
				let prepend = `{
					let defs = ${todo.fieldsCode}
					let issues = {}
					let fields = [${block.vars.map(xVar => `['${xVar.key.slice(1)}', @${xVar.accessor}]`)}]

					for(let [key, value] of fields){
						try{
							let def = defs[key]

							if(!def)
								continue

							for(let func of [def.submit, def.change, def.input]){
								if(func)
									await func(value)
							}
						}catch(e){
							issues[key] = e
							if(typeof e === 'string')
								throw {status: 400, fields: {[key]: e}}
							else
								throw e
						}
					}

					if(Object.keys(issues) > 0){
						throw {
							status: 400,
							message: null,
							fields: issues
						}
					}
				};`
				let firstBracketIndex = block.code.indexOf('{')

				let modifiedBlock = {
					...block,
					clientTemplate: `
						(async () => {
							try{
								return %
							}catch(e){
								this.status.issue = e.message
								this.assignFieldStatus(e.fields)
								throw e
							}
						})()
					`,
					code: block.code.slice(0, firstBracketIndex+1) + '\n' + prepend + '\n' + block.code.slice(firstBracketIndex+1),
				}

				modifiedBlocks.push(modifiedBlock)
			}

			return modifiedBlocks
		}
	}
]


function extractBlock(src, locator, includeLocator){
	return extractBlocks(src, locator, includeLocator)[0]
}

function extractBlocks(src, locator, includeLocator){
	let regex = new RegExp('('+locator+')' + '(.*)\{', 'g')
	let match
	let blocks = []

	while(true){
		match = regex.exec(src)

		if(!match)
			break

		let [start, end] = getBlockBounds(src, match.index + match[0].length - 1)

		start -= match[2].length

		if(includeLocator)
			start -= match[1].length

		blocks.push(src.slice(start, end))
	}

	return blocks
}

function getBlockBounds(src, start){
	let braces = 0

	for(let i=start; i<src.length; i++){
		let char = src.charAt(i)

		if(char === '{'){
			braces++
		}else if(char === '}'){
			braces--

			if(braces === 0){
				return [start, i+1]
			}
		}
	}
}