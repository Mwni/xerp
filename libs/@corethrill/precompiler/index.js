import babel from '@babel/core'
import jsx from '@babel/plugin-transform-react-jsx'
import * as transforms from './transforms/index.js'

export default options => {
	return (code, file) => {
		if(file){
			options.extensions = options.extensions || []

			let extensions = options.extensions.map(extension => ({
				operator: extension.operator.bind(null, extension.todo(code, file))
			}))

			if(file.endsWith('blueprint.js')){
				code = transforms.blueprint({code, side: options.side, extensions})
			}

			if(transforms.model.is(code)){
				code = transforms.model({code, side: options.side, extensions})
			}
		}

		if(!file || file.endsWith('.jsc')){
			code = transforms.logic(code)
		}

		if(!file || file.endsWith('.jsx') || file.endsWith('.jsc')){
			try{
				code = babel.transformSync(code, {
					plugins: [
						[jsx, {
							pragma: '$',
							pragmaFrag: '\'[\''
						}]
					]
				}).code
			}catch(e){
				console.error('[precompiler] error:', e)
			}

			code = `import $ from '@corethrill/core'\n${code}`
		}

		return code
	}
}