## Market Events

Market Events is a Discord bot to remind a channel about upcoming market events.

Currently, the only supported event type is earnings reports: Add a reminder with `/earnings reminder <symbol>`

Example:

> [user] 
> `/earnings reminder RIVN`

> [bot] 
> RIVN reports earnings on February 12, 2026 after market close.
> I'll remind you before the report

Later, the bot sends a reminder:

> ## Earnings Reminders
>
> ### February 12, 2026 after market close
>
> RIVN

The reminder is formatted this way so that multiple symbols may be listed in the reminder.
