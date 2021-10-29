const expressionTagRegex = /\{(\#|\:|\/)[a-z]+.+}/g
const keywordScopes = {if: ['if', 'elif', 'else'], for: ['for']}

function getAllExpressionTags(code){
	let tags = []
	let match

	while(match = expressionTagRegex.exec(code)){
		let start = match.index
		let end = start + match[0].length
		let content = code.slice(start+1, end-1)
		let kwi = content.indexOf(' ')

		if(kwi === -1)
			kwi = content.length

		tags.push({
			start, end, content,
			prefix: content.charAt(0),
			keyword: content.slice(1, kwi),
			expression: content.slice(kwi + 1)
		})
	}

	return tags
}

function buildExpressionTree(tags){
	let tree = []


	for(let i=0; i<tags.length; i++){
		let tag = tags[i]

		if(tag.prefix === '#'){
			let stack = 0
			let component = {
				tag: tag,
				keyword: tag.keyword,
				expression: tag.expression,
				bodyStart: tag.end,
				index: i,
			}
			let components = [component]

			for(let u=i+1; u<tags.length; u++){
				let utag = tags[u]

				if(keywordScopes[tag.keyword].includes(utag.keyword)){
					if(utag.prefix === '#'){
						stack++
					}else if(utag.prefix === ':'){
						if(stack === 0){
							Object.assign(component, {
								bodyEnd: utag.start,
								children: buildExpressionTree(tags.slice(component.index+1, u))
							})

							component = {
								tag: utag,
								keyword: utag.keyword,
								expression: utag.expression,
								bodyStart: utag.end,
								index: u,
							}
							components.push(component)
						}
					}else if(utag.prefix === '/'){
						stack--

						if(stack < 0){
							Object.assign(component, {
								bodyEnd: utag.start,
								children: buildExpressionTree(tags.slice(component.index+1, u))
							})

							tree.push({
								type: tag.keyword,
								start: components[0].tag.start,
								end: utag.end,
								components
							})

							i = u
							break
						}
					}
				}
			}
		}
	}

	return tree
}


function buildAssembly(blocks, depth){
	let assembly = []

	depth = depth || 0

	for(let block of blocks){
		for(let component of block.components){
			assembly = [...assembly, ...buildAssembly(component.children, depth+1)]
		}

		let template = '{%}'
		let fragments = []

		switch(block.type){
			case 'if': 
				let conditionals = block.components
					.filter(comp => comp.keyword !== 'else')
				let elseBlock = block.components
					.find(comp => comp.keyword === 'else')

				for(let i=0; i<conditionals.length; i++){
					let conditional = conditionals[i]

					template = template.replace('%', `(${conditional.expression}) ? (<>$${i}</>) : (%)`)
					fragments = [...fragments, {start: conditional.bodyStart, end: conditional.bodyEnd}]
				}

				if(elseBlock){
					template = template.replace('%', `<>$${conditionals.length}</>`)
					fragments = [...fragments, {start: elseBlock.bodyStart, end: elseBlock.bodyEnd}]
				}else{
					template = template.replace('%', 'null')
				}
				break
			

			case 'for': 
				let loopComponent = block.components[0]

				template = `{(() => {let e = []; for(${loopComponent.expression}){e.push((<>$0</>))}; return e})()}`
				fragments = [{start: loopComponent.bodyStart, end: loopComponent.bodyEnd}]
				break
			
		}

		assembly.push({template, fragments, depth, start: block.start, end: block.end})
	}

	return assembly.sort((a, b) => a.depth - b.depth)
}

export default code => {
	let expressionTags = getAllExpressionTags(code)
	let expressionBlocks = buildExpressionTree(expressionTags)
	let assembly = buildAssembly(expressionBlocks)

	while(true){
		let instruction = assembly.pop()

		if(!instruction)
			break

		let beforeCode = code.slice(0, instruction.start)
		let afterCode = code.slice(instruction.end)
		let innerCode = instruction.template

		for(let i=0; i<instruction.fragments.length; i++){
			let {start, end} = instruction.fragments[i]
			let fragmentCode = code.slice(start, end)

			innerCode = innerCode.replace(`$${i}`, fragmentCode)
		}

		code = beforeCode + innerCode + afterCode

		let deltaLength = innerCode.length - (instruction.end - instruction.start)

		for(let inst of assembly){
			if(inst.start >= instruction.end)
				inst.start += deltaLength
			

			if(inst.end >= instruction.end)
				inst.end += deltaLength
			

			for(let fragment of inst.fragments){
				if(fragment.start >= instruction.end)
					fragment.start += deltaLength

				if(fragment.end >= instruction.end)
					fragment.end += deltaLength
			}
		}
	}

	return code
}