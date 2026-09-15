// ClearEvo.com Doctor - logic
// Copyright (C) 2026 Kasidit Yusuf
//
// This program is free software; you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free
// Software Foundation; either version 2 of the License, or (at your option)
// any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
// more details: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
// Source: https://github.com/ykasidit/clearevo_online_tools

// 'almost' Emacs doctor - a small ELIZA-style Rogerian engine. Pure, tested.
// Not the real doctor.el algorithm, just an affectionate imitation.

const REFLECT = {
  i: 'you', me: 'you', my: 'your', mine: 'yours', am: 'are', im: "you're",
  you: 'I', your: 'my', yours: 'mine', are: 'am', was: 'were', myself: 'yourself',
};

export function reflect(text) {
  return text.split(/\s+/).map((w) => {
    const key = w.toLowerCase().replace(/[^a-z']/g, '');
    return REFLECT[key.replace("'", '')] ?? w;
  }).join(' ').replace(/[.!?]+$/, '');
}

// [regex, [templates...]] - $1 is the reflected capture
const RULES = [
  [/\b(?:i am|i'?m) (.*)/i, ['Why do you say you are $1?', 'How long have you been $1?', 'Do you believe it is normal to be $1?']],
  [/\bi feel (.*)/i, ['Tell me more about feeling $1.', 'Do you often feel $1?', 'What does feeling $1 remind you of?']],
  [/\bi (?:want|need) (.*)/i, ['Why do you want $1?', 'What would it mean to you if you got $1?', 'Suppose you got $1 - then what?']],
  [/\bi (?:think|believe) (.*)/i, ['Do you really think $1?', 'But you are not sure $1?']],
  [/\bi can'?t (.*)/i, ["What makes you think you can't $1?", "Have you tried to $1?", "Perhaps you could $1 now?"]],
  [/\b(?:mother|father|mom|dad|family|brother|sister)\b/i, ['Tell me more about your family.', 'How do you get along with your family?', 'Is your family important to you?']],
  [/\bdream(s|ed|t)?\b/i, ['What does that dream suggest to you?', 'Do you dream often?', 'Are you disturbed by your dreams?']],
  [/\b(?:hello|hi|hey)\b/i, ['How do you do. What brings you to see me?', 'Hello. What seems to be your problem?']],
  [/\b(?:computer|machine|program|ai|robot|claude|emacs)\b/i, ['Do computers worry you?', 'Are you talking about me in particular?', 'What do you think machines have to do with your problem?']],
  [/\bsorry\b/i, ["Please don't apologize.", 'Apologies are not necessary here.']],
  [/\bbecause (.*)/i, ['Is that the real reason?', "Don't any other reasons come to mind?", 'Does that reason explain anything else?']],
  [/\b(?:always|never|everyone|nobody)\b/i, ['Can you think of a specific example?', 'Really - are you sure it is that absolute?', 'When, in particular?']],
  [/\byes\b/i, ['You seem quite positive.', 'I see. And what does that tell you?', 'I understand.']],
  [/\bno\b/i, ['Why not?', 'You are being a bit negative.', 'Are you saying no just to be negative?']],
  [/\bfriend(s)?\b/i, ['Tell me more about your friends.', 'Do your friends ever pick on you?', 'Why do you bring up the topic of friends?']],
  [/\byou (?:are|'re) (.*)/i, ['What makes you think I am $1?', 'Does it please you to believe I am $1?']],
  [/\b(?:sad|depressed|unhappy|miserable)\b/i, ['I am sorry to hear that you are feeling this way.', 'What do you think is the cause?', 'Has this been going on long?']],
  [/\b(?:happy|glad|great|good)\b/i, ['How have I helped you to feel that way?', 'What makes you feel good right now?']],
];

const FALLBACKS = [
  'Please, go on.',
  'Can you elaborate on that?',
  'Why do you say that?',
  'What does that suggest to you?',
  'I see. Tell me more.',
  'How does that make you feel?',
  'Is it because of your plans that you say that?',
];

// verbatim from doctor.el's greeting
export const GREETING =
  'I am the psychotherapist.  Please, describe your problems.  Each time\n' +
  'you are finished talking, type RET twice, i.e., press the RET key\n' +
  'twice in a row.';

export function createDoctor() {
  return { fallbackIdx: 0, last: '' };
}

export function doctorReply(input, state) {
  const text = input.trim();
  if (!text) return 'I would appreciate it if you would say something.';
  if (/\b(?:bye|goodbye|quit|exit)\b/i.test(text)) {
    return 'My secretary will send you a bill.';
  }
  for (const [re, templates] of RULES) {
    const m = text.match(re);
    if (m) {
      for (let i = 0; i < templates.length; i++) {
        const t = templates[(i + state.fallbackIdx) % templates.length];
        const reply = t.replace('$1', m[1] ? reflect(m[1]) : '');
        if (reply !== state.last) { state.last = reply; return reply; }
      }
    }
  }
  const reply = FALLBACKS[state.fallbackIdx++ % FALLBACKS.length];
  state.last = reply;
  return reply;
}
