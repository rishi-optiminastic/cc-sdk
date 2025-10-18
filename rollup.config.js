import { terser } from 'rollup-plugin-terser';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default [
 
  {
    input: 'src/index.js',
    output: {
      file: 'dist/carboncut.min.js',
      format: 'iife',
      name: 'CarbonCut',
      sourcemap: true
    },
    plugins: [
      nodeResolve(),
      commonjs(),
      terser({
        compress: {
          drop_console: false
        }
      })
    ]
  },
 
  {
    input: 'src/index.js',
    output: {
      file: 'dist/carboncut.js',
      format: 'iife',
      name: 'CarbonCut',
      sourcemap: true
    },
    plugins: [
      nodeResolve(),
      commonjs()
    ]
  },
 
  {
    input: 'src/index.js',
    output: {
      file: 'dist/carboncut.esm.js',
      format: 'es',
      sourcemap: true
    },
    plugins: [
      nodeResolve(),
      commonjs()
    ]
  },
 
  {
    input: 'src/index.js',
    output: {
      file: 'dist/carboncut.cjs.js',
      format: 'cjs',
      sourcemap: true
    },
    plugins: [
      nodeResolve(),
      commonjs()
    ]
  }
];