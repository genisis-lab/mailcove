# Third-party notices

Mailcove is an independent implementation. The projects below informed its
design; where code was adapted, the license permits it and the origin is noted.

## QuickInbox (MIT)

https://github.com/DivinPrince/quickinbox — Copyright (c) 2026 Irasubiza Divin Prince.

Small, self-contained pieces were adapted under the MIT license:

- Svix-style webhook signature verification in pure Web Crypto
  (`src/worker/mail/providers/resend/webhook-signature.ts`).
- The shape of the minimal Resend REST client and its receiving-API fallback
  from `data_uri` to `cid` HTML for oversized messages
  (`src/worker/mail/providers/resend/client.ts`).
- Preferring the `From:` header over the SMTP envelope sender for Cloudflare
  inbound mail so bounce-relay addresses never show up as the sender.
- Verifying push-subscription ownership inside the service worker before
  displaying a notification.

The MIT license text for QuickInbox:

```
MIT License

Copyright (c) 2026 Irasubiza Divin Prince

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Mailflare (source-available, no code reused)

https://github.com/hieunc229/mailflare — Copyright (c) 2026 Hieu Nguyen.

Mailflare's license does not permit redistribution of its code. Mailcove
reuses **no** Mailflare source. Its public feature set (routing rules, shared
mailboxes, auto-replies, backups, audit logs) served only as a behavioral
checklist while designing Mailcove's own implementation.

## Gmail

Mailcove's interface takes inspiration from familiar webmail conventions
(three-pane layout, labels, snooze, undo send, keyboard shortcuts). It is not
affiliated with or endorsed by Google, and no Google assets are used.
