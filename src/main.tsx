import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import FashnVtonTest from './components/FashnVtonTest.tsx';
import './index.css';

const root = createRoot(document.getElementById('root')!);
if (window.location.pathname === '/try-on-lab') {
  root.render(<FashnVtonTest />);
} else {
  root.render(<App />);
}
