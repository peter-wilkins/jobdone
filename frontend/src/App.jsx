import { useState } from 'react';
import { HomeScreen } from './HomeScreen';
import { FeedbackScreen } from './FeedbackScreen';

function App() {
  const [screen, setScreen] = useState('home');

  if (screen === 'feedback') {
    return <FeedbackScreen onBack={() => setScreen('home')} />;
  }

  return <HomeScreen onNavigate={setScreen} />;
}

export default App;
