import React from 'react';
import {createRoot} from 'react-dom/client';
import MovieMentorConversationCore from './src/components/studio/mentor/MovieMentorConversationCore.jsx';
createRoot(document.getElementById('root')).render(<MovieMentorConversationCore creatorName="Isolated Creator" projectId="isolated-project" showJourney={false} showStartPointChooser={false} allowAttachments={false} allowVoice={false} onSendMessage={()=>{throw Error('NETWORK_SEND_NOT_AUTHORIZED_IN_SMOKE')}}/>);
