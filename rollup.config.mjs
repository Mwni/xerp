import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import precompile from '@corethrill/precompiler'

export default [
	{
		input: './src/ui-entry.js',
		plugins: [ 
			resolve({
				preferBuiltins: false,
				browser: true
			}), 
			commonjs(),
			{transform: precompile({side: 'client'})},
		],
		output: {
			file: './chrome/app.js',
			format: 'iife',
			name: 'app'
		}
	},
	{
		input: './src/bg-entry.js',
		plugins: [
			resolve({
				preferBuiltins: false,
				browser: true
			}), 
			commonjs(),
		],
		output: {
			file: './chrome/background.js',
			format: 'iife',
			name: 'background'
		}
	}
]