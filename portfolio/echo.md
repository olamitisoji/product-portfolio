# Echo

An AI interviewer that lets people take part in research through WhatsApp voice notes or text.

**My role** · Product design, interview workflow, and AI-assisted implementation

**Status** · Built and used internally

## Why I built it

My team wanted to understand how hospitals and other healthcare organizations handle administrative work. People agreed to talk to us, but scheduling time with busy professionals often took longer than the interview itself. Some offered to answer our questions with voice notes instead.

Listening to those notes, I kept hearing things I wanted to ask about. A participant might mention that an AI tool had become unreliable. Hearing when the problem started or how someone first noticed it could be more valuable than moving on to the next prepared question. I wanted to keep that part of a live interview and let people answer whenever they had time.

## Decisions I owned

I kept the participant experience inside WhatsApp, where people were already comfortable recording answers. The researcher uses a separate workspace to define what they want to learn, approve the interview guide, and review transcripts. A participant opens an invitation, reads the AI disclosure, gives consent, and can answer, pause, skip a topic, or stop inside the chat.

The hardest decision was how much freedom to give the interviewer. A fixed list would recreate the original voice-note problem. An unrestricted interviewer could keep probing the same point. I designed a guide that specifies which details matter and how many follow-ups are allowed. The model interprets each reply and proposes a question. The application enforces consent, tracks what the participant has already covered, and decides which actions the guide allows.

I designed the experience from invitation through transcript review and used AI coding tools to build the backend and researcher workspace.

## What happened

We completed a real-device interview on Meta’s WhatsApp test number. Echo received consent, transcribed voice notes, sent relevant follow-ups, handled pause and resume, and completed the interview. The researcher could retrieve the transcript afterward.

**In our team’s experience, research that took roughly two weeks to coordinate and conduct now takes under three days.** That is our observation from using Echo internally across the ideas we were exploring. Participants can answer between other commitments, and we can review the transcripts without manually piecing together recordings.

## What I’d test next

A relevant follow-up in one interview is a starting point. I’d ask two reviewers to score whether each follow-up is neutral, uses what the participant already said, and helps answer the research question. I’d include vague replies and answers that already cover the next topic, then inspect where Echo asks a question a human interviewer would skip. [Research evaluation plan](../docs/EVALUATION.md)

[Technical guide and setup](../docs/ECHO.md) · [Conversation rules](../docs/ENGINE.md) · [Verification record](../docs/VERIFICATION.md) · [Back to portfolio](README.md)
