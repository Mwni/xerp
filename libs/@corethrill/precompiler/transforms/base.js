export function extractImports(src){
	return src
		.split(/\n|\r\n/g)
		.filter(line => /^import +/g.test(line))
		.join('\n')
}

export function extractBlock(src, locator, includeLocator){
	return extractBlocks(src, locator, includeLocator)[0]
}

export function extractBlocks(src, locator, includeLocator){
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

export function findEnclosingFunctionName(src, index){
	let classMethodRegex = /(async +)?([a-zA-Z\_]+) *\(.*\) *\n*\{/g

	while(true){
		let match = classMethodRegex.exec(src)

		if(!match)
			break

		let [start, end] = getBlockBounds(src, match.index + match[0].length - 1)

		if(index >= start && index < end){
			return match[2]
		}
	}
}

export function stripStrings(src){
	let regex = /(\'|\"|\`)/g

	while(true){
		let match = regex.exec(src)

		if(!match)
			break

		let closing = src.indexOf(match[1], match.index+1)

		src = src.slice(0, match.index) + src.slice(closing+1)
	}

	return src
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