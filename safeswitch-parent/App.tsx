import { SafeAreaProvider } from 'react-native-safe-area-context';
import SafeSwitchDashboard from './SafeSwitchDashboard';

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeSwitchDashboard />
    </SafeAreaProvider>
  );
}