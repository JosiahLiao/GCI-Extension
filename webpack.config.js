import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  entry: './background.js',
  output: {
    filename: 'background.bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  mode: 'development', // or 'production'
  devtool: false, // Disable source maps that use eval() for CSP compliance
  resolve: {
    alias: {
      'zod/v3': path.resolve(__dirname, 'lib/zod/v3'),
      'zod/v4': path.resolve(__dirname, 'lib/zod/v4'),
    },
    // Add '.js' to resolve extensions for imports that might be missing them
    extensions: ['.js', '.json', '.mjs'] 
  },
  experiments: {
    outputModule: false,
  },
};
