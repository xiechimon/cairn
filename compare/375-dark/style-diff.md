# Style diff: claude.ai vs cairn

Reference run: `/home/ian/.cache/cairn-design-capture/final/claude-ai-375-dark`
Ours run: `/home/ian/.cache/cairn-design-capture/final/cairn-375-dark`

## shell / initial

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 235 vs 136

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 14, 32x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x88 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.36) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x22 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgb(156, 199, 139) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | Anthropicons-Variable x12<br>anthropic-sans x11<br>anthropic-serif x1 | instrumentSans x37<br>jetbrainsMono x2 |
| fontSize (6 vs 5) | 20px x6<br>13px x6<br>16px x4<br>12px x4<br>14px x3<br>24px x1 | 14px x26<br>13px x8<br>15px x2<br>12px x2<br>17px x1 |
| fontWeight (6 vs 4) | 433.25 x6<br>400 x6<br>435 x5<br>533.25 x3<br>577.75 x3<br>360 x1 | 450 x27<br>500 x5<br>600 x4<br>700 x3 |
| lineHeight (8 vs 7) | 20px x8<br>16px x5<br>19px x4<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>17px x1 | 24px x23<br>18px x6<br>20px x4<br>22.5px x2<br>16.8px x2<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x24 | normal x39 |
| color (4 vs 5) | rgba(255, 255, 255, 0.93) x14<br>rgba(255, 255, 255, 0.57) x6<br>rgba(255, 255, 255, 0.4) x3<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x24<br>rgb(163, 170, 164) x8<br>rgb(180, 186, 179) x5<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1 |
| backgroundColor (7 vs 11) | hsl(none 0% 100% / 0.1) x8<br>rgb(25, 25, 25) x6<br>rgb(31, 31, 31) x2<br>rgb(11, 11, 11) x2<br>hsl(none 0% 9.80392%) x1<br>rgb(48, 48, 48) x1<br>rgba(255, 255, 255, 0.05) x1 | rgb(42, 48, 43) x4<br>rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(38, 44, 39) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgb(163, 170, 164) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1 |
| borderTopLeftRadius (5 vs 5) | 8px x41<br>7px x12<br>6px x9<br>11px x8<br>14px x1 | 8px x8<br>3.35544e+07px x5<br>4px x3<br>12px x2<br>14px x2 |
| boxShadow (3 vs 2) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 100% / 0.1) 0px 0px 0px 1px x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (1 vs 3) | hsl(none 0% 100% / 0.2) x2 | rgba(0, 0, 0, 0) x7<br>rgb(53, 59, 54) x1<br>rgb(107, 114, 108) x1 |
| borderTopWidth (1 vs 1) | 0.8px x2 | 1px x9 |
| paddingTop (6 vs 6) | 8px x7<br>5px x3<br>14px x2<br>4px x2<br>16px x1<br>12px x1 | 1px x3<br>2px x3<br>8px x2<br>14px x1<br>6px x1<br>12px x1 |
| paddingLeft (6 vs 9) | 8px x14<br>12px x5<br>4px x4<br>14px x2<br>23.04px x1<br>1px x1 | 2px x3<br>10px x2<br>12px x2<br>4px x2<br>6px x2<br>9px x2<br>56px x1<br>16px x1<br>14px x1 |
| rowGap (8 vs 4) | 4px x20<br>6px x17<br>8px x7<br>24px x1<br>28px x1<br>2px x1<br>5px x1<br>12px x1 | 8px x13<br>4px x5<br>2px x4<br>6px x3 |
| columnGap (8 vs 5) | 4px x20<br>6px x17<br>8px x5<br>24px x1<br>28px x1<br>2px x1<br>5px x1<br>12px x1 | 8px x12<br>4px x5<br>2px x4<br>6px x3<br>10px x1 |
| transitionDuration (8 vs 1) | 0.06s x35<br>0.45s x17<br>0.2s x10<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1<br>0.15s x1 | 0.15s x2 |
| transitionTimingFunction (5 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x26<br>cubic-bezier(0.165, 0.84, 0.44, 1) x25<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x17<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (2 vs 1) | static-composer-actions-fade-in x4<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x11<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## shell / hover-sidebar-rows

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 479 vs 198

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 14, 32x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x88 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.22) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x22 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| dialog | count, size | 1, 375.2x812 | 1, 288x812 |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 435 | 450 |
| dialog | lineHeight | 21px | 20px |
| dialog | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog | backgroundColor | rgb(31, 31, 31) | rgba(0, 0, 0, 0) |
| dialog | borderTopStyle | none | solid |
| dialog | borderTopColor | rgba(255, 255, 255, 0.93) | rgb(53, 59, 54) |
| dialog | borderRightStyle | none | solid |
| dialog | borderRightColor | rgba(255, 255, 255, 0.1) | rgb(53, 59, 54) |
| dialog | borderBottomStyle | none | solid |
| dialog | borderBottomColor | rgba(255, 255, 255, 0.93) | rgb(53, 59, 54) |
| dialog | borderLeftStyle | none | solid |
| dialog | borderLeftColor | rgba(255, 255, 255, 0.93) | rgb(53, 59, 54) |
| dialog | boxShadow | none | rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0, 0.6) 0px 24px 48px -12px, rgba(255, 255 |
| dialog | outlineWidth | 2.4px | 3px |
| dialog | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog | paddingRight | 8px | 0px |
| dialog | paddingBottom | 8px | 0px |
| dialog | paddingLeft | 8px | 0px |
| dialog | rowGap | 8px | 0px |
| dialog | columnGap | 8px | 0px |
| dialog | maxWidth | none | 318.75px |
| dialog | transitionProperty | transform, visibility | all |
| dialog | transitionDuration | 0.3s, 0s | 0.2s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1), ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog | animationName | none | enter |
| dialog | animationDuration | 0s | 0.2s |
| dialog | animationTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.radiogroup | presence | 1 | absent |
| dialog.select | presence | 12 | absent |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | count, size | 1, 32x32 | 1, 288x812 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | lineHeight | 21px | 20px |
| shell.sidebar | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | backgroundColor | rgba(0, 0, 0, 0) | rgb(20, 23, 21) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| shell.sidebar | transitionProperty | none | all |
| sidebar.footer | count, size | 12, 36x36 | 1, 264x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 20px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.footer | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| sidebar.footer | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| sidebar.footer | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| sidebar.footer | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 264x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgba(230, 232, 226, 0.09) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 6, 359.2x44 | 2, 264x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | lineHeight | 21px | 20px |
| sidebar.row | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(255, 255, 255, 0.93)","radius":"0p | null |
| sidebar.row.fill | count, size | 1, 375.2x812 | 1, 288x812 |
| sidebar.row.fill | position | fixed | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | lineHeight | 21px | 20px |
| sidebar.row.fill | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.row.fill | backgroundColor | rgb(31, 31, 31) | rgb(20, 23, 21) |
| sidebar.row.fill | borderTopStyle | none | solid |
| sidebar.row.fill | borderTopColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.row.fill | borderRightStyle | none | solid |
| sidebar.row.fill | borderRightColor | rgba(255, 255, 255, 0.1) | rgb(230, 232, 226) |
| sidebar.row.fill | borderBottomStyle | none | solid |
| sidebar.row.fill | borderBottomColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.row.fill | borderLeftStyle | none | solid |
| sidebar.row.fill | borderLeftColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 8px | 12px |
| sidebar.row.fill | paddingBottom | 8px | 10px |
| sidebar.row.fill | paddingLeft | 8px | 12px |
| sidebar.row.fill | rowGap | 8px | normal |
| sidebar.row.fill | columnGap | 8px | normal |
| sidebar.row.fill | transitionProperty | transform, visibility | all |
| sidebar.row.fill | transitionDuration | 0.3s, 0s | 0s |
| sidebar.row.fill | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1), ease | ease |
| sidebar.section | count, size | 14, 32x32 | 3, 264x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| sidebar.section | outlineOffset | 1.6px | 0px |
| sidebar.section | paddingRight | 0px | 8px |
| sidebar.section | paddingLeft | 0px | 8px |
| sidebar.section | rowGap | 6px | 8px |
| sidebar.section | columnGap | 6px | 8px |
| sidebar.section | transitionProperty | box-shadow | all |
| sidebar.section | transitionDuration | 0.06s | 0.15s |
| sidebar.section | animationName | static-composer-actions-fade-in | none |
| sidebar.section | animationDuration | 0.24s | 0s |
| sidebar.section | animationTimingFunction | ease-out | ease |
| sidebar.section | cursor | pointer | default |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | Anthropicons-Variable x38<br>anthropic-sans x35<br>anthropic-serif x2 | instrumentSans x48<br>jetbrainsMono x2 |
| fontSize (7 vs 6) | 20px x32<br>14px x17<br>12px x14<br>13px x6<br>16px x4<br>15px x1<br>24px x1 | 14px x29<br>12px x9<br>13px x8<br>15px x2<br>17px x1<br>20px x1 |
| fontWeight (8 vs 5) | 433.25 x31<br>435 x20<br>400 x13<br>577.75 x4<br>533.25 x3<br>520 x2<br>500 x1<br>360 x1 | 450 x30<br>500 x10<br>600 x6<br>700 x3<br>650 x1 |
| lineHeight (9 vs 9) | 20px x36<br>21px x15<br>12px x9<br>16px x5<br>19px x4<br>22px x2<br>18px x2<br>28.8px x1<br>17px x1 | 24px x23<br>20px x7<br>16px x7<br>18px x6<br>22.5px x2<br>16.8px x2<br>12px x1<br>21px x1<br>26px x1 |
| letterSpacing (1 vs 1) | normal x75 | normal x50 |
| color (5 vs 6) | rgba(255, 255, 255, 0.93) x52<br>rgba(255, 255, 255, 0.57) x18<br>rgba(255, 255, 255, 0.4) x3<br>rgb(51, 185, 59) x1<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x30<br>rgb(163, 170, 164) x11<br>rgb(180, 186, 179) x6<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1<br>rgb(26, 20, 4) x1 |
| backgroundColor (9 vs 13) | hsl(none 0% 100% / 0.1) x10<br>rgb(25, 25, 25) x6<br>rgb(31, 31, 31) x3<br>rgba(255, 255, 255, 0.15) x2<br>rgb(11, 11, 11) x2<br>hsl(none 0% 100% / 0.05) x1<br>hsl(none 0% 9.80392%) x1<br>rgb(48, 48, 48) x1<br>rgba(255, 255, 255, 0.05) x1 | rgb(42, 48, 43) x5<br>rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x2<br>rgb(235, 181, 80) x2<br>rgb(163, 170, 164) x2<br>rgb(230, 232, 226) x2<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(38, 44, 39) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1<br>rgba(0, 0, 0, 0.5) x1<br>rgba(230, 232, 226, 0.09) x1 |
| borderTopLeftRadius (8 vs 5) | 8px x75<br>6px x44<br>7px x14<br>11px x8<br>10px x3<br>5px x2<br>2.68435e+07px x1<br>14px x1 | 8px x20<br>3.35544e+07px x7<br>4px x3<br>12px x2<br>14px x2 |
| boxShadow (4 vs 3) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 100% / 0.1) 0px 0px 0px 1px x2<br>hsl(none 0% 100% / 0.2) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1<br>rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0, 0.6) 0px  x1 |
| borderTopColor (1 vs 3) | hsl(none 0% 100% / 0.2) x2 | rgba(0, 0, 0, 0) x10<br>rgb(53, 59, 54) x1<br>rgb(107, 114, 108) x1 |
| borderTopWidth (1 vs 1) | 0.8px x2 | 1px x12 |
| paddingTop (7 vs 6) | 8px x8<br>4px x5<br>16px x3<br>5px x3<br>14px x2<br>1px x1<br>12px x1 | 8px x3<br>1px x3<br>2px x3<br>12px x2<br>14px x1<br>6px x1 |
| paddingLeft (9 vs 10) | 8px x22<br>2px x15<br>4px x8<br>12px x5<br>1px x2<br>10px x2<br>14px x2<br>16px x1<br>23.04px x1 | 10px x5<br>8px x5<br>12px x3<br>4px x3<br>6px x3<br>2px x3<br>9px x2<br>56px x1<br>16px x1<br>14px x1 |
| rowGap (9 vs 6) | 4px x50<br>6px x35<br>2px x16<br>8px x9<br>5px x3<br>1.8px x1<br>24px x1<br>28px x1<br>12px x1 | 8px x15<br>6px x8<br>2px x6<br>4px x6<br>1px x5<br>10px x2 |
| columnGap (9 vs 6) | 4px x50<br>6px x35<br>2px x16<br>8px x7<br>5px x3<br>1.8px x1<br>24px x1<br>28px x1<br>12px x1 | 8px x14<br>6px x8<br>2px x6<br>4px x6<br>1px x5<br>10px x3 |
| transitionDuration (9 vs 3) | 0.06s x65<br>0.45s x31<br>0.2s x10<br>0.28s x3<br>0.15s x2<br>0.12s x2<br>0.5s x1<br>0.3s, 0s x1<br>0.12s, 0s x1 | 0.15s x11<br>0.1s x1<br>0.2s x1 |
| transitionTimingFunction (6 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x43<br>cubic-bezier(0.165, 0.84, 0.44, 1) x39<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x31<br>cubic-bezier(0.165, 0.84, 0.44, 1), ease x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x12<br>ease x1 |
| animationName (3 vs 2) | static-composer-actions-fade-in x6<br>task-grid-fade-in, task-grid-clip-reveal x1<br>cds-fade-in x1 | enter x2<br>live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x19<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## shell / press-composer-plus

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 302 vs 129

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 14, 32x32 | 2, 72.8x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x88 | 2, 319x70 |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| composer.box | borderTopWidth | 0px | 1px |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(156, 199, 139) |
| composer.box | borderRightWidth | 0px | 1px |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(156, 199, 139) |
| composer.box | borderBottomWidth | 0px | 1px |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(156, 199, 139) |
| composer.box | borderLeftWidth | 0px | 1px |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(156, 199, 139) |
| composer.box | borderTopLeftRadius | 14px | 8px |
| composer.box | borderTopRightRadius | 14px | 8px |
| composer.box | borderBottomRightRadius | 14px | 8px |
| composer.box | borderBottomLeftRadius | 14px | 8px |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | oklab(0.783543 -0.0690071 0.0643196 / 0.5) 0px 0px 0px 3px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 0px |
| composer.box | paddingRight | 8px | 0px |
| composer.box | paddingBottom | 8px | 0px |
| composer.box | paddingLeft | 8px | 0px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.box | transitionDuration | 0.2s | 0.15s |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 6, 72.8x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x22 | 2, 317x36 |
| composer.input | display | block | flex |
| composer.input | position | relative | static |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 14px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 20px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 8px |
| composer.input | paddingRight | 0px | 10px |
| composer.input | paddingBottom | 0px | 8px |
| composer.input | paddingLeft | 0px | 10px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| menu | presence | 1 | absent |
| menu.item | presence | 9 | absent |
| menu.separator | presence | 2 | absent |
| message.actions.button | presence | absent | 1 |
| message.reply | presence | absent | 2 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | Anthropicons-Variable x27<br>anthropic-sans x20<br>anthropic-serif x1 | instrumentSans x36<br>jetbrainsMono x2 |
| fontSize (7 vs 4) | 20px x16<br>16px x9<br>15px x9<br>13px x6<br>12px x4<br>14px x3<br>24px x1 | 14px x26<br>13px x9<br>12px x2<br>15px x1 |
| fontWeight (8 vs 4) | 433.25 x15<br>435 x13<br>533.25 x8<br>400 x6<br>577.75 x3<br>360 x1<br>566.5 x1<br>520 x1 | 450 x27<br>500 x5<br>600 x3<br>700 x3 |
| lineHeight (8 vs 7) | 20px x19<br>16px x10<br>22px x9<br>19px x4<br>12px x3<br>21px x1<br>28.8px x1<br>17px x1 | 24px x22<br>18px x7<br>20px x4<br>16.8px x2<br>12px x1<br>21px x1<br>22.5px x1 |
| letterSpacing (1 vs 1) | normal x48 | normal x38 |
| color (5 vs 5) | rgba(255, 255, 255, 0.93) x32<br>rgba(255, 255, 255, 0.57) x11<br>rgba(255, 255, 255, 0.4) x3<br>rgb(135, 135, 135) x1<br>rgb(37, 125, 224) x1 | rgb(230, 232, 226) x22<br>rgb(163, 170, 164) x9<br>rgb(180, 186, 179) x5<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1 |
| backgroundColor (11 vs 10) | hsl(none 0% 100% / 0.1) x8<br>rgb(25, 25, 25) x6<br>rgb(48, 48, 48) x2<br>rgb(31, 31, 31) x2<br>rgb(11, 11, 11) x2<br>rgba(255, 255, 255, 0.1) x2<br>hsl(none 0% 9.80392%) x1<br>rgba(255, 255, 255, 0.075) x1<br>rgba(255, 255, 255, 0.05) x1<br>rgba(0, 0, 0, 0.5) x1<br>rgba(255, 255, 255, 0.04) x1 | rgb(42, 48, 43) x5<br>rgb(34, 39, 35) x3<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x2<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgb(163, 170, 164) x1<br>rgb(230, 232, 226) x1 |
| borderTopLeftRadius (7 vs 6) | 8px x41<br>7px x12<br>10px x10<br>6px x9<br>11px x8<br>14px x2<br>2.68435e+07px x1 | 8px x9<br>3.35544e+07px x5<br>4px x3<br>14px x2<br>12px x1<br>5px x1 |
| boxShadow (4 vs 3) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 100% / 0.1) 0px 0px 0px 1px x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, rgba(0, 0,  x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>oklab(0.783543 -0.0690071 0.0643196 / 0.5) 0px 0px 0px 3px x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (1 vs 4) | hsl(none 0% 100% / 0.2) x2 | rgba(0, 0, 0, 0) x8<br>rgb(53, 59, 54) x1<br>rgb(107, 114, 108) x1<br>rgb(156, 199, 139) x1 |
| borderTopWidth (1 vs 1) | 0.8px x2 | 1px x11 |
| paddingTop (7 vs 6) | 9px x9<br>8px x7<br>5px x3<br>4px x3<br>14px x2<br>16px x1<br>12px x1 | 1px x3<br>2px x3<br>8px x2<br>14px x1<br>6px x1<br>12px x1 |
| paddingLeft (7 vs 9) | 8px x14<br>10px x10<br>4px x5<br>12px x5<br>14px x2<br>23.04px x1<br>1px x1 | 10px x4<br>2px x3<br>4px x2<br>6px x2<br>9px x2<br>56px x1<br>16px x1<br>12px x1<br>14px x1 |
| rowGap (8 vs 4) | 4px x20<br>8px x19<br>6px x17<br>24px x1<br>28px x1<br>2px x1<br>5px x1<br>12px x1 | 8px x14<br>2px x4<br>4px x4<br>6px x3 |
| columnGap (8 vs 5) | 4px x20<br>6px x17<br>8px x17<br>24px x1<br>28px x1<br>2px x1<br>5px x1<br>12px x1 | 8px x13<br>2px x4<br>4px x4<br>6px x3<br>10px x1 |
| transitionDuration (9 vs 1) | 0.06s x35<br>0.45s x17<br>0.2s x10<br>0.28s x3<br>0.3s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1<br>0.15s x1 | 0.15s x4 |
| transitionTimingFunction (5 vs 1) | cubic-bezier(0.165, 0.84, 0.44, 1) x28<br>cubic-bezier(0.4, 0, 0.2, 1) x26<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x17<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x4 |
| animationName (4 vs 1) | static-composer-actions-fade-in x4<br>task-grid-fade-in, task-grid-clip-reveal x1<br>cds-fade-in x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x10<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## shell / type-composer

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 168 vs 129

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 32x32 | 2, 72.8x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x110 | 2, 319x70 |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| composer.box | borderTopWidth | 0px | 1px |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(156, 199, 139) |
| composer.box | borderRightWidth | 0px | 1px |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(156, 199, 139) |
| composer.box | borderBottomWidth | 0px | 1px |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(156, 199, 139) |
| composer.box | borderLeftWidth | 0px | 1px |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(156, 199, 139) |
| composer.box | borderTopLeftRadius | 14px | 8px |
| composer.box | borderTopRightRadius | 14px | 8px |
| composer.box | borderBottomRightRadius | 14px | 8px |
| composer.box | borderBottomLeftRadius | 14px | 8px |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | oklab(0.783543 -0.0690071 0.0643196 / 0.5) 0px 0px 0px 3px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 0px |
| composer.box | paddingRight | 8px | 0px |
| composer.box | paddingBottom | 8px | 0px |
| composer.box | paddingLeft | 8px | 0px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.box | transitionDuration | 0.2s | 0.15s |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 6, 72.8x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x44 | 2, 317x36 |
| composer.input | display | block | flex |
| composer.input | position | relative | static |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 14px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 20px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 8px |
| composer.input | paddingRight | 0px | 10px |
| composer.input | paddingBottom | 0px | 8px |
| composer.input | paddingLeft | 0px | 10px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 1 |
| message.reply | presence | absent | 2 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | Anthropicons-Variable x9<br>anthropic-sans x5<br>anthropic-serif x1 | instrumentSans x37<br>jetbrainsMono x2 |
| fontSize (6 vs 4) | 20px x5<br>13px x3<br>12px x3<br>16px x2<br>14px x1<br>24px x1 | 14px x27<br>13px x9<br>12px x2<br>15px x1 |
| fontWeight (6 vs 4) | 433.25 x5<br>435 x3<br>577.75 x3<br>400 x2<br>360 x1<br>533.25 x1 | 450 x28<br>500 x5<br>600 x3<br>700 x3 |
| lineHeight (7 vs 7) | 20px x5<br>19px x3<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>16px x1 | 24px x22<br>18px x7<br>20px x5<br>16.8px x2<br>12px x1<br>21px x1<br>22.5px x1 |
| letterSpacing (1 vs 1) | normal x15 | normal x39 |
| color (3 vs 5) | rgba(255, 255, 255, 0.93) x11<br>rgba(255, 255, 255, 0.57) x3<br>rgb(255, 255, 255) x1 | rgb(230, 232, 226) x23<br>rgb(163, 170, 164) x9<br>rgb(180, 186, 179) x5<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1 |
| backgroundColor (4 vs 10) | rgb(25, 25, 25) x2<br>hsl(none 0% 9.80392%) x1<br>rgb(48, 48, 48) x1<br>rgb(198, 97, 63) x1 | rgb(42, 48, 43) x4<br>rgb(34, 39, 35) x3<br>rgb(230, 232, 226) x2<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x2<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgb(163, 170, 164) x1 |
| borderTopLeftRadius (2 vs 6) | 8px x38<br>14px x1 | 8px x9<br>3.35544e+07px x5<br>4px x3<br>14px x2<br>12px x1<br>5px x1 |
| boxShadow (1 vs 3) | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(255, 255, 2 x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>oklab(0.783543 -0.0690071 0.0643196 / 0.5) 0px 0px 0px 3px x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (0 vs 4) |  | rgba(0, 0, 0, 0) x8<br>rgb(53, 59, 54) x1<br>rgb(107, 114, 108) x1<br>rgb(156, 199, 139) x1 |
| borderTopWidth (0 vs 1) |  | 1px x11 |
| paddingTop (3 vs 6) | 8px x4<br>5px x2<br>16px x1 | 1px x3<br>2px x3<br>8px x2<br>14px x1<br>6px x1<br>12px x1 |
| paddingLeft (5 vs 9) | 8px x10<br>4px x2<br>12px x2<br>23.04px x1<br>1px x1 | 10px x4<br>2px x3<br>4px x2<br>6px x2<br>9px x2<br>56px x1<br>16px x1<br>12px x1<br>14px x1 |
| rowGap (6 vs 4) | 4px x17<br>6px x13<br>8px x7<br>24px x1<br>28px x1<br>2px x1 | 8px x14<br>2px x4<br>4px x4<br>6px x3 |
| columnGap (6 vs 5) | 4px x17<br>6px x13<br>8px x5<br>24px x1<br>28px x1<br>2px x1 | 8px x13<br>2px x4<br>4px x4<br>6px x3<br>10px x1 |
| transitionDuration (7 vs 1) | 0.06s x28<br>0.45s x10<br>0.2s x4<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x4 |
| transitionTimingFunction (5 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x20<br>cubic-bezier(0.165, 0.84, 0.44, 1) x17<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x10<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x4 |
| animationName (1 vs 1) | task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x10<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## shell / open-model-menu

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 372 vs 155

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 14, 32x32 | 2, 72.8x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x88 | 2, 319x70 |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| composer.box | borderTopWidth | 0px | 1px |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.box | borderRightWidth | 0px | 1px |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.box | borderBottomWidth | 0px | 1px |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.box | borderLeftWidth | 0px | 1px |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.box | borderTopLeftRadius | 14px | 8px |
| composer.box | borderTopRightRadius | 14px | 8px |
| composer.box | borderBottomRightRadius | 14px | 8px |
| composer.box | borderBottomLeftRadius | 14px | 8px |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | none |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 0px |
| composer.box | paddingRight | 8px | 0px |
| composer.box | paddingBottom | 8px | 0px |
| composer.box | paddingLeft | 8px | 0px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.box | transitionDuration | 0.2s | 0.15s |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 6, 72.8x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x22 | 2, 317x36 |
| composer.input | display | block | flex |
| composer.input | position | relative | static |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 14px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 20px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.input | paddingTop | 0px | 8px |
| composer.input | paddingRight | 0px | 10px |
| composer.input | paddingBottom | 0px | 8px |
| composer.input | paddingLeft | 0px | 10px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.model | backgroundColor | rgba(0, 0, 0, 0) | rgb(42, 48, 43) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| menu | count, size | 1, 375.2x731 | 1, 320x180 |
| menu | display | flex | block |
| menu | position | relative | static |
| menu | fontFamily | anthropic-sans | instrumentSans |
| menu | fontWeight | 400 | 450 |
| menu | lineHeight | 20px | 21px |
| menu | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| menu | backgroundColor | rgb(48, 48, 48) | rgb(38, 43, 39) |
| menu | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| menu | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| menu | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| menu | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| menu | borderBottomRightRadius | 0px | 12px |
| menu | borderBottomLeftRadius | 0px | 12px |
| menu | boxShadow | rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.32) 0px 8px 24px 0px, rgb | rgba(0, 0, 0, 0.4) 0px 2px 6px 0px, rgba(0, 0, 0, 0.45) 0px 10px 28px 0px, rgba(255, 255,  |
| menu | outlineWidth | 2.4px | 3px |
| menu | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| menu | paddingTop | 0px | 4px |
| menu | paddingRight | 0px | 4px |
| menu | paddingBottom | 8px | 4px |
| menu | paddingLeft | 0px | 4px |
| menu | maxWidth | none | 320px |
| menu | transitionProperty | translate, height, scale | all |
| menu | transitionDuration | 0.3s | 0.1s |
| menu | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | ease |
| menu | animationName | none | enter |
| menu | animationDuration | 0s | 0.1s |
| menu | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.5)","color":"rgba(255, 255, 255, 0.93)","radius":" | null |
| menu.item | count, size | 18, 367.2x50 | 3, 312x48 |
| menu.item | position | static | relative |
| menu.item | fontFamily | anthropic-sans | instrumentSans |
| menu.item | fontWeight | 435 | 450 |
| menu.item | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| menu.item | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| menu.item | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| menu.item | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| menu.item | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| menu.item | outlineWidth | 2.4px | 3px |
| menu.item | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| menu.item | paddingRight | 10px | 32px |
| menu.item | paddingBottom | 7px | 6px |
| menu.item | rowGap | 8px | 10px |
| menu.item | columnGap | 8px | 10px |
| menu.item | cursor | pointer | default |
| menu.separator | presence | 2 | absent |
| message.actions.button | presence | absent | 1 |
| message.reply | presence | absent | 2 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | anthropic-sans x36<br>Anthropicons-Variable x16<br>anthropic-serif x1 | instrumentSans x43<br>jetbrainsMono x2 |
| fontSize (7 vs 4) | 14px x20<br>13px x12<br>20px x9<br>12px x5<br>16px x4<br>10px x2<br>24px x1 | 14px x29<br>13px x9<br>12px x6<br>15px x1 |
| fontWeight (8 vs 4) | 435 x26<br>400 x8<br>433.25 x7<br>577.75 x4<br>533.25 x3<br>566.5 x2<br>500 x2<br>360 x1 | 450 x30<br>500 x9<br>600 x3<br>700 x3 |
| lineHeight (8 vs 8) | 20px x28<br>17px x7<br>12px x6<br>16px x5<br>19px x4<br>21px x1<br>28.8px x1<br>22px x1 | 24px x22<br>20px x7<br>18px x7<br>16px x4<br>16.8px x2<br>12px x1<br>21px x1<br>22.5px x1 |
| letterSpacing (1 vs 1) | normal x53 | normal x45 |
| color (6 vs 5) | rgba(255, 255, 255, 0.93) x32<br>rgba(255, 255, 255, 0.57) x13<br>rgba(255, 255, 255, 0.4) x3<br>rgb(37, 125, 224) x2<br>rgb(228, 156, 6) x2<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x25<br>rgb(163, 170, 164) x13<br>rgb(180, 186, 179) x5<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1 |
| backgroundColor (12 vs 11) | hsl(none 0% 100% / 0.1) x8<br>rgb(25, 25, 25) x6<br>rgb(48, 48, 48) x2<br>rgb(31, 31, 31) x2<br>rgb(11, 11, 11) x2<br>rgba(255, 255, 255, 0.1) x2<br>hsl(none 0% 9.80392%) x1<br>rgba(255, 255, 255, 0.05) x1<br>rgba(255, 255, 255, 0.075) x1<br>rgba(0, 0, 0, 0.5) x1<br>rgba(255, 255, 255, 0.04) x1<br>rgba(251, 179, 21, 0.08) x1 | rgb(42, 48, 43) x6<br>rgb(34, 39, 35) x3<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x2<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgb(163, 170, 164) x1<br>rgb(230, 232, 226) x1<br>rgb(38, 43, 39) x1 |
| borderTopLeftRadius (7 vs 6) | 8px x62<br>7px x12<br>6px x9<br>11px x8<br>14px x1<br>12px x1<br>2.68435e+07px x1 | 8px x12<br>3.35544e+07px x5<br>4px x3<br>12px x2<br>14px x2<br>5px x1 |
| boxShadow (4 vs 3) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 100% / 0.1) 0px 0px 0px 1px x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, rgba(0, 0,  x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1<br>rgba(0, 0, 0, 0.4) 0px 2px 6px 0px, rgba(0, 0, 0, 0.45) 0px  x1 |
| borderTopColor (3 vs 3) | hsl(none 0% 100% / 0.2) x2<br>rgba(255, 255, 255, 0.25) x1<br>rgba(0, 0, 0, 0) x1 | rgba(0, 0, 0, 0) x8<br>rgb(107, 114, 108) x2<br>rgb(53, 59, 54) x1 |
| borderTopWidth (1 vs 1) | 0.8px x4 | 1px x11 |
| paddingTop (8 vs 7) | 6px x18<br>8px x7<br>4px x5<br>5px x3<br>14px x2<br>1.25px x2<br>16px x1<br>12px x1 | 6px x4<br>1px x3<br>8px x3<br>2px x3<br>14px x1<br>12px x1<br>4px x1 |
| paddingLeft (8 vs 9) | 10px x20<br>8px x14<br>12px x5<br>4px x4<br>14px x2<br>3px x2<br>23.04px x1<br>1px x1 | 10px x8<br>4px x3<br>2px x3<br>6px x2<br>9px x2<br>56px x1<br>16px x1<br>12px x1<br>14px x1 |
| rowGap (8 vs 5) | 8px x59<br>4px x22<br>6px x17<br>24px x1<br>28px x1<br>2px x1<br>5px x1<br>12px x1 | 8px x14<br>2px x4<br>4px x4<br>6px x3<br>10px x3 |
| columnGap (8 vs 5) | 8px x57<br>4px x22<br>6px x17<br>24px x1<br>28px x1<br>2px x1<br>5px x1<br>12px x1 | 8px x13<br>2px x4<br>4px x4<br>10px x4<br>6px x3 |
| transitionDuration (9 vs 2) | 0.06s x35<br>0.45s x17<br>0.2s x10<br>0.28s x3<br>0.3s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1<br>0.15s x1 | 0.15s x4<br>0.1s x1 |
| transitionTimingFunction (5 vs 2) | cubic-bezier(0.165, 0.84, 0.44, 1) x28<br>cubic-bezier(0.4, 0, 0.2, 1) x26<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x17<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x4<br>ease x1 |
| animationName (3 vs 2) | task-grid-fade-in, task-grid-clip-reveal x1<br>fade-in x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1 | live-pulse x1<br>enter x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x11<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## shell / collapse-sidebar

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 479 vs 191

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 14, 32x32 | 2, 72.8x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x88 | 2, 319x70 |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| composer.box | borderTopWidth | 0px | 1px |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.box | borderRightWidth | 0px | 1px |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.box | borderBottomWidth | 0px | 1px |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.box | borderLeftWidth | 0px | 1px |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.box | borderTopLeftRadius | 14px | 8px |
| composer.box | borderTopRightRadius | 14px | 8px |
| composer.box | borderBottomRightRadius | 14px | 8px |
| composer.box | borderBottomLeftRadius | 14px | 8px |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | none |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 0px |
| composer.box | paddingRight | 8px | 0px |
| composer.box | paddingBottom | 8px | 0px |
| composer.box | paddingLeft | 8px | 0px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.box | transitionDuration | 0.2s | 0.15s |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 6, 72.8x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x22 | 2, 317x36 |
| composer.input | display | block | flex |
| composer.input | position | relative | static |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 14px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 20px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.input | paddingTop | 0px | 8px |
| composer.input | paddingRight | 0px | 10px |
| composer.input | paddingBottom | 0px | 8px |
| composer.input | paddingLeft | 0px | 10px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| dialog | count, size | 1, 375.2x812 | 1, 288x812 |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 435 | 450 |
| dialog | lineHeight | 21px | 20px |
| dialog | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog | backgroundColor | rgb(31, 31, 31) | rgba(0, 0, 0, 0) |
| dialog | borderTopStyle | none | solid |
| dialog | borderTopColor | rgba(255, 255, 255, 0.93) | rgb(53, 59, 54) |
| dialog | borderRightStyle | none | solid |
| dialog | borderRightColor | rgba(255, 255, 255, 0.1) | rgb(53, 59, 54) |
| dialog | borderBottomStyle | none | solid |
| dialog | borderBottomColor | rgba(255, 255, 255, 0.93) | rgb(53, 59, 54) |
| dialog | borderLeftStyle | none | solid |
| dialog | borderLeftColor | rgba(255, 255, 255, 0.93) | rgb(53, 59, 54) |
| dialog | boxShadow | none | rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0, 0.6) 0px 24px 48px -12px, rgba(255, 255 |
| dialog | outlineWidth | 2.4px | 3px |
| dialog | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog | paddingRight | 8px | 0px |
| dialog | paddingBottom | 8px | 0px |
| dialog | paddingLeft | 8px | 0px |
| dialog | rowGap | 8px | 0px |
| dialog | columnGap | 8px | 0px |
| dialog | maxWidth | none | 318.75px |
| dialog | transitionProperty | transform, visibility | all |
| dialog | transitionDuration | 0.3s, 0s | 0.2s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1), ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog | animationName | none | enter |
| dialog | animationDuration | 0s | 0.2s |
| dialog | animationTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.radiogroup | presence | 1 | absent |
| dialog.select | presence | 12 | absent |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 1 |
| message.reply | presence | absent | 2 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | count, size | 1, 32x32 | 1, 288x812 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | lineHeight | 21px | 20px |
| shell.sidebar | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | backgroundColor | rgba(0, 0, 0, 0) | rgb(20, 23, 21) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| shell.sidebar | transitionProperty | none | all |
| sidebar.footer | count, size | 12, 36x36 | 1, 264x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 20px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.footer | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| sidebar.footer | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| sidebar.footer | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| sidebar.footer | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 264x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgba(230, 232, 226, 0.09) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 6, 359.2x44 | 2, 264x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | lineHeight | 21px | 20px |
| sidebar.row | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(255, 255, 255, 0.93)","radius":"0p | null |
| sidebar.row.fill | count, size | 1, 375.2x812 | 1, 288x812 |
| sidebar.row.fill | position | fixed | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | lineHeight | 21px | 20px |
| sidebar.row.fill | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.row.fill | backgroundColor | rgb(31, 31, 31) | rgb(20, 23, 21) |
| sidebar.row.fill | borderTopStyle | none | solid |
| sidebar.row.fill | borderTopColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.row.fill | borderRightStyle | none | solid |
| sidebar.row.fill | borderRightColor | rgba(255, 255, 255, 0.1) | rgb(230, 232, 226) |
| sidebar.row.fill | borderBottomStyle | none | solid |
| sidebar.row.fill | borderBottomColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.row.fill | borderLeftStyle | none | solid |
| sidebar.row.fill | borderLeftColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 8px | 12px |
| sidebar.row.fill | paddingBottom | 8px | 10px |
| sidebar.row.fill | paddingLeft | 8px | 12px |
| sidebar.row.fill | rowGap | 8px | normal |
| sidebar.row.fill | columnGap | 8px | normal |
| sidebar.row.fill | transitionProperty | transform, visibility | all |
| sidebar.row.fill | transitionDuration | 0.3s, 0s | 0s |
| sidebar.row.fill | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1), ease | ease |
| sidebar.section | count, size | 14, 32x32 | 3, 264x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| sidebar.section | outlineOffset | 1.6px | 0px |
| sidebar.section | paddingRight | 0px | 8px |
| sidebar.section | paddingLeft | 0px | 8px |
| sidebar.section | rowGap | 6px | 8px |
| sidebar.section | columnGap | 6px | 8px |
| sidebar.section | transitionProperty | box-shadow | all |
| sidebar.section | transitionDuration | 0.06s | 0.15s |
| sidebar.section | cursor | pointer | default |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | Anthropicons-Variable x38<br>anthropic-sans x35<br>anthropic-serif x2 | instrumentSans x47<br>jetbrainsMono x2 |
| fontSize (7 vs 5) | 20px x32<br>14px x17<br>12px x14<br>13px x6<br>16px x4<br>15px x1<br>24px x1 | 14px x29<br>13px x9<br>12px x9<br>15px x1<br>20px x1 |
| fontWeight (8 vs 5) | 433.25 x31<br>435 x20<br>400 x13<br>577.75 x4<br>533.25 x3<br>520 x2<br>500 x1<br>360 x1 | 450 x30<br>500 x10<br>600 x5<br>700 x3<br>650 x1 |
| lineHeight (9 vs 9) | 20px x36<br>21px x15<br>12px x9<br>16px x5<br>19px x4<br>22px x2<br>18px x2<br>28.8px x1<br>17px x1 | 24px x22<br>20px x7<br>18px x7<br>16px x7<br>16.8px x2<br>12px x1<br>21px x1<br>22.5px x1<br>26px x1 |
| letterSpacing (1 vs 1) | normal x75 | normal x49 |
| color (5 vs 6) | rgba(255, 255, 255, 0.93) x52<br>rgba(255, 255, 255, 0.57) x18<br>rgba(255, 255, 255, 0.4) x3<br>rgb(51, 185, 59) x1<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x28<br>rgb(163, 170, 164) x12<br>rgb(180, 186, 179) x6<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1<br>rgb(26, 20, 4) x1 |
| backgroundColor (9 vs 12) | hsl(none 0% 100% / 0.1) x10<br>rgb(25, 25, 25) x6<br>rgb(31, 31, 31) x3<br>rgba(255, 255, 255, 0.15) x2<br>rgb(11, 11, 11) x2<br>hsl(none 0% 100% / 0.05) x1<br>hsl(none 0% 9.80392%) x1<br>rgb(48, 48, 48) x1<br>rgba(255, 255, 255, 0.05) x1 | rgb(42, 48, 43) x6<br>rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x2<br>rgb(235, 181, 80) x2<br>rgb(163, 170, 164) x2<br>rgb(230, 232, 226) x2<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x2<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgba(0, 0, 0, 0.5) x1<br>rgba(230, 232, 226, 0.09) x1 |
| borderTopLeftRadius (8 vs 6) | 8px x75<br>6px x44<br>7px x14<br>11px x8<br>10px x3<br>5px x2<br>2.68435e+07px x1<br>14px x1 | 8px x21<br>3.35544e+07px x7<br>4px x3<br>14px x2<br>12px x1<br>5px x1 |
| boxShadow (4 vs 3) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 100% / 0.1) 0px 0px 0px 1px x2<br>hsl(none 0% 100% / 0.2) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1<br>rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0, 0.6) 0px  x1 |
| borderTopColor (1 vs 3) | hsl(none 0% 100% / 0.2) x2 | rgba(0, 0, 0, 0) x11<br>rgb(107, 114, 108) x2<br>rgb(53, 59, 54) x1 |
| borderTopWidth (1 vs 1) | 0.8px x2 | 1px x14 |
| paddingTop (7 vs 6) | 8px x8<br>4px x5<br>16px x3<br>5px x3<br>14px x2<br>1px x1<br>12px x1 | 1px x3<br>8px x3<br>2px x3<br>12px x2<br>14px x1<br>6px x1 |
| paddingLeft (9 vs 10) | 8px x22<br>2px x15<br>4px x8<br>12px x5<br>1px x2<br>10px x2<br>14px x2<br>16px x1<br>23.04px x1 | 10px x7<br>8px x5<br>4px x3<br>6px x3<br>2px x3<br>12px x2<br>9px x2<br>56px x1<br>16px x1<br>14px x1 |
| rowGap (9 vs 6) | 4px x50<br>6px x35<br>2px x16<br>8px x9<br>5px x3<br>1.8px x1<br>24px x1<br>28px x1<br>12px x1 | 8px x16<br>6px x8<br>2px x6<br>4px x5<br>1px x5<br>10px x2 |
| columnGap (9 vs 6) | 4px x50<br>6px x35<br>2px x16<br>8px x7<br>5px x3<br>1.8px x1<br>24px x1<br>28px x1<br>12px x1 | 8px x15<br>6px x8<br>2px x6<br>4px x5<br>1px x5<br>10px x3 |
| transitionDuration (9 vs 3) | 0.06s x65<br>0.45s x31<br>0.2s x10<br>0.28s x3<br>0.15s x2<br>0.12s x2<br>0.5s x1<br>0.3s, 0s x1<br>0.12s, 0s x1 | 0.15s x13<br>0.1s x1<br>0.2s x1 |
| transitionTimingFunction (6 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x43<br>cubic-bezier(0.165, 0.84, 0.44, 1) x39<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x31<br>cubic-bezier(0.165, 0.84, 0.44, 1), ease x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x14<br>ease x1 |
| animationName (3 vs 2) | task-grid-fade-in, task-grid-clip-reveal x1<br>cds-fade-in x1<br>fade-in x1 | enter x2<br>live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x18<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## shell / open-settings-dialog

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 357 vs 203

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | presence | 14 | absent |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x88 | 1, 130.8x34.4 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.22) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 10px |
| composer.box | marginRight | 0px | 16px |
| composer.box | marginBottom | 0px | 10px |
| composer.box | marginLeft | 0px | 16px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 2, 11.2x11.2 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.button | opacity | 1 | 0.5 |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | rowGap | 6px | normal |
| composer.button | columnGap | 6px | normal |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.input | count, size | 1, 319.2x22 | 1, 119.6x14.4 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | presence | 1 | absent |
| dialog | count, size | 1, 343.2x780 | 2, 375x812 |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 400 | 450 |
| dialog | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog | backgroundColor | rgb(48, 48, 48) | rgb(27, 31, 28) |
| dialog | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderTopLeftRadius | 12px | 0px |
| dialog | borderTopRightRadius | 12px | 0px |
| dialog | borderBottomRightRadius | 12px | 0px |
| dialog | borderBottomLeftRadius | 12px | 0px |
| dialog | boxShadow | rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% 4.31373% / 0.08) 0px 4px 8px  | none |
| dialog | outlineWidth | 2.4px | 3px |
| dialog | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| dialog | maxWidth | 720px | none |
| dialog | transitionProperty | opacity, scale, filter | all |
| dialog | transitionDuration | 0.2s | 0s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | ease |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.5)","color":"rgba(255, 255, 255, 0.93)","radius":" | null |
| dialog.input | presence | 11 | absent |
| dialog.radiogroup | presence | 1 | absent |
| dialog.select | presence | 7 | absent |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 143.6x24.8 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingTop | 0px | 4px |
| shell.header | paddingRight | 0px | 16px |
| shell.header | paddingBottom | 0px | 12px |
| shell.header | paddingLeft | 0px | 16px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.main | presence | 1 | absent |
| shell.sidebar | count, size | 1, 32x32 | 1, 143.6x240 |
| shell.sidebar | position | absolute | fixed |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | backgroundColor | rgba(0, 0, 0, 0) | rgb(34, 39, 35) |
| shell.sidebar | opacity | 1 | 0 |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderTopLeftRadius | 0px | 18px |
| shell.sidebar | borderTopRightRadius | 0px | 18px |
| shell.sidebar | borderBottomRightRadius | 0px | 18px |
| shell.sidebar | borderBottomLeftRadius | 0px | 18px |
| shell.sidebar | boxShadow | none | rgb(53, 59, 54) 0px 0px 0px 0.5px inset, rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0 |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.sidebar | maxWidth | none | 359px |
| shell.sidebar | transitionDuration | 0s | 0.2s |
| shell.sidebar | transitionTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| shell.sidebar | animationName | none | exit |
| shell.sidebar | animationDuration | 0s | 0.2s |
| shell.sidebar | animationTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | anthropic-sans x34<br>Anthropicons-Variable x23<br>anthropic-serif x2 | instrumentSans x48<br>jetbrainsMono x2 |
| fontSize (7 vs 5) | 14px x24<br>16px x11<br>20px x10<br>13px x6<br>12px x4<br>15px x3<br>24px x1 | 14px x35<br>12px x5<br>13px x5<br>15px x3<br>17px x2 |
| fontWeight (7 vs 5) | 435 x17<br>400 x15<br>433.25 x10<br>533.25 x10<br>577.75 x3<br>520 x3<br>360 x1 | 450 x37<br>500 x8<br>700 x3<br>650 x1<br>600 x1 |
| lineHeight (8 vs 7) | 20px x36<br>16px x12<br>19px x4<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>17px x1 | 24px x24<br>20px x14<br>22.5px x3<br>16px x3<br>18px x3<br>16.8px x2<br>12px x1 |
| letterSpacing (1 vs 1) | normal x59 | normal x50 |
| color (4 vs 4) | rgba(255, 255, 255, 0.93) x42<br>rgba(255, 255, 255, 0.57) x13<br>rgba(255, 255, 255, 0.4) x3<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x23<br>rgb(180, 186, 179) x13<br>rgb(163, 170, 164) x13<br>rgb(242, 207, 134) x1 |
| backgroundColor (9 vs 9) | hsl(none 0% 100% / 0.1) x9<br>rgb(25, 25, 25) x6<br>rgb(48, 48, 48) x3<br>hsl(none 0% 100% / 0.05) x3<br>rgb(31, 31, 31) x2<br>rgb(11, 11, 11) x2<br>hsl(none 0% 9.80392%) x1<br>rgba(255, 255, 255, 0.05) x1<br>rgba(0, 0, 0, 0.5) x1 | rgb(42, 48, 43) x4<br>rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x2<br>rgba(0, 0, 0, 0.6) x1<br>rgb(27, 31, 28) x1<br>rgba(230, 232, 226, 0.09) x1<br>rgb(38, 44, 39) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgb(163, 170, 164) x1 |
| borderTopLeftRadius (7 vs 6) | 8px x53<br>7px x13<br>6px x12<br>11px x8<br>50% x3<br>12px x2<br>14px x1 | 8px x17<br>4px x3<br>12px x2<br>3.35544e+07px x2<br>18px x1<br>14px x1 |
| boxShadow (6 vs 2) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 100% / 0.1) 0px 0px 0px 1px x2<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% x1<br>hsl(none 0% 100% / 0.2) 0px 0px 0px 1px x1 | rgb(53, 59, 54) 0px 0px 0px 0.5px inset, rgba(0, 0, 0, 0.4)  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (2 vs 2) | hsl(none 0% 100% / 0.05) x5<br>hsl(none 0% 100% / 0.2) x2 | rgba(0, 0, 0, 0) x2<br>rgb(53, 59, 54) x1 |
| borderTopWidth (1 vs 1) | 0.8px x7 | 1px x3 |
| paddingTop (7 vs 6) | 8px x9<br>12px x8<br>5px x3<br>16px x2<br>14px x2<br>4px x2<br>1px x1 | 4px x4<br>1px x3<br>2px x3<br>12px x2<br>8px x2<br>14px x1 |
| paddingLeft (7 vs 8) | 8px x22<br>12px x10<br>4px x4<br>16px x3<br>1px x2<br>14px x2<br>23.04px x1 | 10px x17<br>4px x3<br>2px x3<br>16px x2<br>6px x2<br>8px x1<br>12px x1<br>14px x1 |
| rowGap (9 vs 7) | 6px x40<br>4px x30<br>12px x9<br>8px x7<br>28px x3<br>24px x1<br>2px x1<br>5px x1<br>16px x1 | 10px x13<br>8px x12<br>4px x5<br>1px x4<br>2px x3<br>12px x1<br>16px x1 |
| columnGap (9 vs 7) | 6px x40<br>4px x30<br>12px x9<br>8px x5<br>28px x3<br>24px x1<br>2px x1<br>5px x1<br>16px x1 | 10px x13<br>8px x12<br>4px x5<br>1px x4<br>2px x3<br>12px x1<br>16px x1 |
| transitionDuration (8 vs 2) | 0.06s x47<br>0.45s x18<br>0.2s x12<br>0.15s x8<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x16<br>0.2s x1 |
| transitionTimingFunction (5 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x44<br>cubic-bezier(0.165, 0.84, 0.44, 1) x28<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x18<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x16<br>cubic-bezier(0.32, 0.72, 0, 1) x1 |
| animationName (5 vs 2) | task-grid-fade-in, task-grid-clip-reveal x1<br>cds-fade-in x1<br>fade-in x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1<br>cds-scroll-fade-left, cds-scroll-fade-right, cds-scroll-fade x1 | exit x1<br>live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x22<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## chat-long / initial

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 238 vs 140

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 17, 169.2x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 12px | 9px |
| button.primary | paddingLeft | 12px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | text | default |
| composer.box | count, size | 1, 343.2x48 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.36) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 19px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | marginTop | -4px | 0px |
| composer.button | marginBottom | -4px | 0px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 281.2x22 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgb(156, 199, 139) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | count, size | 1, 36x36 | 1, 32x32 |
| jump | fontFamily | anthropic-sans | instrumentSans |
| jump | fontWeight | 400 | 500 |
| jump | lineHeight | 21px | 20px |
| jump | whiteSpace | normal | nowrap |
| jump | color | rgba(255, 255, 255, 0.93) | rgb(180, 186, 179) |
| jump | backgroundColor | oklab(0.239291 0.0000108778 0.00000478327 / 0.8) | rgb(34, 39, 35) |
| jump | borderTopWidth | 0.8px | 0px |
| jump | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderRightWidth | 0.8px | 0px |
| jump | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderBottomWidth | 0.8px | 0px |
| jump | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderLeftWidth | 0.8px | 0px |
| jump | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderTopLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderTopRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | boxShadow | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, rgba(0, 0, 0, 0.24) 0px 6px 16px 0px | none |
| jump | outlineWidth | 1.6px | 3px |
| jump | outlineStyle | solid | none |
| jump | outlineColor | rgba(81, 156, 237, 0) | rgb(180, 186, 179) |
| jump | outlineOffset | 1.6px | 0px |
| jump | paddingTop | 4px | 0px |
| jump | paddingRight | 4px | 0px |
| jump | paddingBottom | 4px | 0px |
| jump | paddingLeft | 4px | 0px |
| jump | transitionProperty | opacity, border-color | opacity |
| jump | transitionDuration | 0.2s | 0s |
| jump | cursor | pointer | default |
| jump | backdropFilter | blur(8px) | none |
| jump | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(255, 255, 255, 0.93)","radius":"0p | null |
| message.actions.button | count, size | 3, 32x32 | 9, 24x24 |
| message.actions.button | position | relative | static |
| message.actions.button | fontFamily | anthropic-sans | instrumentSans |
| message.actions.button | fontSize | 13px | 14px |
| message.actions.button | fontWeight | 435 | 500 |
| message.actions.button | lineHeight | 19px | 20px |
| message.actions.button | color | rgba(255, 255, 255, 0.57) | rgb(163, 170, 164) |
| message.actions.button | borderTopStyle | solid | none |
| message.actions.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| message.actions.button | borderRightStyle | solid | none |
| message.actions.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| message.actions.button | borderBottomStyle | solid | none |
| message.actions.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| message.actions.button | borderLeftStyle | solid | none |
| message.actions.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| message.actions.button | borderTopLeftRadius | 6px | 0px |
| message.actions.button | borderTopRightRadius | 6px | 0px |
| message.actions.button | borderBottomRightRadius | 6px | 0px |
| message.actions.button | borderBottomLeftRadius | 6px | 0px |
| message.actions.button | outlineWidth | 1.6px | 3px |
| message.actions.button | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| message.actions.button | outlineOffset | 1.6px | 0px |
| message.actions.button | marginTop | -4px | 0px |
| message.actions.button | marginBottom | -4px | 0px |
| message.actions.button | rowGap | 6px | normal |
| message.actions.button | columnGap | 6px | normal |
| message.actions.button | transitionProperty | box-shadow | all |
| message.actions.button | transitionDuration | 0.06s | 0s |
| message.reply | presence | absent | 3 |
| message.reply.p | presence | absent | 3 |
| message.user | presence | absent | 3 |
| message.user.bubble | presence | absent | 3 |
| project.card | presence | absent | 1 |
| shell.header | presence | absent | 1 |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 1) | Anthropicons-Variable x14<br>anthropic-sans x9<br>anthropic-serif x8<br>anthropic-mono x3 | instrumentSans x17 |
| fontSize (7 vs 3) | 16px x8<br>15px x8<br>20px x7<br>13px x4<br>13.5px x3<br>14px x2<br>11px x2 | 15px x7<br>13px x6<br>14px x4 |
| fontWeight (5 vs 3) | 400 x10<br>433.25 x7<br>533.25 x7<br>435 x5<br>600 x5 | 450 x11<br>600 x3<br>500 x3 |
| lineHeight (7 vs 4) | 20px x9<br>21px x8<br>16px x7<br>13.5px x3<br>17px x3<br>19px x3<br>22px x1 | 22.5px x7<br>18px x6<br>20px x3<br>21px x1 |
| letterSpacing (1 vs 1) | normal x34 | normal x17 |
| color (5 vs 4) | rgba(255, 255, 255, 0.93) x19<br>rgba(255, 255, 255, 0.57) x7<br>rgba(255, 255, 255, 0.4) x4<br>oklab(0.999994 0.0000455678 0.0000200868 / 0.929412) x3<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x10<br>rgb(180, 186, 179) x4<br>rgb(163, 170, 164) x2<br>rgb(22, 26, 23) x1 |
| backgroundColor (7 vs 9) | rgb(25, 25, 25) x5<br>rgba(255, 255, 255, 0.075) x3<br>hsl(none 0% 9.80392%) x1<br>color(srgb 0.0980392 0.0980392 0.0980392 / 0.85) x1<br>oklab(0.239291 0.0000108778 0.00000478327 / 0.8) x1<br>rgb(48, 48, 48) x1<br>rgba(255, 255, 255, 0.05) x1 | rgb(38, 44, 39) x3<br>rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1<br>rgb(42, 48, 43) x1 |
| borderTopLeftRadius (5 vs 4) | 8px x40<br>6px x15<br>4px x3<br>2.68435e+07px x1<br>14px x1 | 8px x8<br>3.35544e+07px x4<br>12px x3<br>14px x2 |
| boxShadow (3 vs 2) | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, rgba(0, 0, 0,  x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgb(25, 25, 25) 0px 0px 0px 32px x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (1 vs 2) | rgba(255, 255, 255, 0.04) x1 | rgba(0, 0, 0, 0) x7<br>rgb(107, 114, 108) x1 |
| borderTopWidth (1 vs 1) | 0.8px x1 | 1px x8 |
| paddingTop (6 vs 5) | 8px x4<br>4px x3<br>1px x3<br>5px x3<br>56px x1<br>24px x1 | 8px x3<br>2px x3<br>14px x1<br>6px x1<br>12px x1 |
| paddingLeft (10 vs 8) | 8px x10<br>4px x7<br>12px x4<br>7.5px x4<br>6px x4<br>20px x1<br>30px x1<br>3px x1<br>1px x1<br>32px x1 | 12px x4<br>2px x3<br>9px x2<br>56px x1<br>10px x1<br>16px x1<br>4px x1<br>14px x1 |
| rowGap (4 vs 4) | 4px x27<br>6px x17<br>8px x5<br>20px x1 | 8px x12<br>4px x8<br>6px x3<br>2px x2 |
| columnGap (4 vs 5) | 4px x27<br>6px x17<br>8px x3<br>20px x1 | 8px x11<br>4px x8<br>6px x3<br>2px x2<br>10px x1 |
| transitionDuration (9 vs 1) | 0.06s x39<br>0.45s x15<br>0.2s x8<br>0.12s x2<br>0.28s x2<br>0.5s x1<br>0.3s x1<br>0.15s x1<br>0.12s, 0s x1 | 0.15s x2 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x27<br>cubic-bezier(0.165, 0.84, 0.44, 1) x25<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x15<br>ease-out x1<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (1 vs 0) | task-grid-fade-in, task-grid-clip-reveal x1 |  |
| strokeWidth (2 vs 2) | 1px x1<br>1.25px x1 | 1.75px x17<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## chat-long / scroll-up

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 246 vs 197

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 169.2x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 12px | 9px |
| button.primary | paddingLeft | 12px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | text | default |
| composer.box | count, size | 1, 343.2x48 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.36) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 19px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | marginTop | -4px | 0px |
| composer.button | marginBottom | -4px | 0px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 281.2x22 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgb(156, 199, 139) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | count, size | 1, 36x36 | 1, 32x32 |
| jump | fontFamily | anthropic-sans | instrumentSans |
| jump | fontWeight | 400 | 500 |
| jump | lineHeight | 21px | 20px |
| jump | whiteSpace | normal | nowrap |
| jump | color | rgba(255, 255, 255, 0.93) | rgb(180, 186, 179) |
| jump | backgroundColor | oklab(0.239291 0.0000108778 0.00000478327 / 0.8) | rgb(34, 39, 35) |
| jump | borderTopWidth | 0.8px | 0px |
| jump | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderRightWidth | 0.8px | 0px |
| jump | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderBottomWidth | 0.8px | 0px |
| jump | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderLeftWidth | 0.8px | 0px |
| jump | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderTopLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderTopRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | boxShadow | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, rgba(0, 0, 0, 0.24) 0px 6px 16px 0px | none |
| jump | outlineWidth | 1.6px | 3px |
| jump | outlineStyle | solid | none |
| jump | outlineColor | rgba(81, 156, 237, 0) | rgb(180, 186, 179) |
| jump | outlineOffset | 1.6px | 0px |
| jump | paddingTop | 4px | 0px |
| jump | paddingRight | 4px | 0px |
| jump | paddingBottom | 4px | 0px |
| jump | paddingLeft | 4px | 0px |
| jump | transitionProperty | opacity, border-color | opacity |
| jump | transitionDuration | 0.2s | 0s |
| jump | cursor | pointer | default |
| jump | backdropFilter | blur(8px) | none |
| jump | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(255, 255, 255, 0.93)","radius":"0p | null |
| message.actions.button | count, size | 2, 32x32 | 15, 24x24 |
| message.actions.button | position | relative | static |
| message.actions.button | fontFamily | anthropic-sans | instrumentSans |
| message.actions.button | fontSize | 13px | 14px |
| message.actions.button | fontWeight | 435 | 500 |
| message.actions.button | lineHeight | 19px | 20px |
| message.actions.button | color | rgba(255, 255, 255, 0.57) | rgb(163, 170, 164) |
| message.actions.button | borderTopStyle | solid | none |
| message.actions.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| message.actions.button | borderRightStyle | solid | none |
| message.actions.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| message.actions.button | borderBottomStyle | solid | none |
| message.actions.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| message.actions.button | borderLeftStyle | solid | none |
| message.actions.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| message.actions.button | borderTopLeftRadius | 6px | 0px |
| message.actions.button | borderTopRightRadius | 6px | 0px |
| message.actions.button | borderBottomRightRadius | 6px | 0px |
| message.actions.button | borderBottomLeftRadius | 6px | 0px |
| message.actions.button | outlineWidth | 1.6px | 3px |
| message.actions.button | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| message.actions.button | outlineOffset | 1.6px | 0px |
| message.actions.button | marginTop | -4px | 0px |
| message.actions.button | marginBottom | -4px | 0px |
| message.actions.button | rowGap | 6px | normal |
| message.actions.button | columnGap | 6px | normal |
| message.actions.button | transitionProperty | box-shadow | all |
| message.actions.button | transitionDuration | 0.06s | 0s |
| message.reply | presence | absent | 6 |
| message.reply.p | presence | absent | 6 |
| message.user | count, size | 1, 239.3x126 | 5, 291.5x61 |
| message.user | display | grid | block |
| message.user | position | relative | static |
| message.user | fontFamily | anthropic-sans | instrumentSans |
| message.user | fontWeight | 400 | 450 |
| message.user | lineHeight | 21px | 22.5px |
| message.user | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| message.user | backgroundColor | rgba(0, 0, 0, 0) | rgb(38, 44, 39) |
| message.user | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| message.user | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| message.user | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| message.user | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| message.user | borderTopLeftRadius | 0px | 12px |
| message.user | borderTopRightRadius | 0px | 12px |
| message.user | borderBottomRightRadius | 0px | 12px |
| message.user | borderBottomLeftRadius | 0px | 12px |
| message.user | outlineWidth | 2.4px | 3px |
| message.user | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| message.user | paddingTop | 0px | 8px |
| message.user | paddingRight | 0px | 12px |
| message.user | paddingBottom | 0px | 8px |
| message.user | paddingLeft | 0px | 12px |
| message.user | rowGap | 8px | normal |
| message.user | columnGap | 8px | normal |
| message.user | maxWidth | none | 100% |
| message.user.bubble | count, size | 1, 271.3x150 | 5, 291.5x61 |
| message.user.bubble | display | flex | block |
| message.user.bubble | position | relative | static |
| message.user.bubble | fontFamily | anthropic-sans | instrumentSans |
| message.user.bubble | fontWeight | 400 | 450 |
| message.user.bubble | lineHeight | 21px | 22.5px |
| message.user.bubble | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| message.user.bubble | backgroundColor | hsl(none 0% 100% / 0.05) | rgb(38, 44, 39) |
| message.user.bubble | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| message.user.bubble | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| message.user.bubble | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| message.user.bubble | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| message.user.bubble | outlineWidth | 2.4px | 3px |
| message.user.bubble | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| message.user.bubble | paddingTop | 12px | 8px |
| message.user.bubble | paddingRight | 16px | 12px |
| message.user.bubble | paddingBottom | 12px | 8px |
| message.user.bubble | paddingLeft | 16px | 12px |
| message.user.bubble | rowGap | 8px | normal |
| message.user.bubble | columnGap | 8px | normal |
| message.user.bubble | maxWidth | 85% | 100% |
| project.card | presence | absent | 1 |
| shell.header | presence | absent | 1 |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 1) | anthropic-sans x14<br>Anthropicons-Variable x12<br>anthropic-mono x11<br>anthropic-serif x8 | instrumentSans x22 |
| fontSize (7 vs 3) | 13.5px x11<br>15px x10<br>20px x7<br>16px x6<br>14px x5<br>13px x4<br>11px x2 | 15px x12<br>13px x6<br>14px x4 |
| fontWeight (5 vs 3) | 400 x26<br>433.25 x7<br>435 x5<br>533.25 x5<br>600 x2 | 450 x16<br>600 x3<br>500 x3 |
| lineHeight (7 vs 4) | 21px x13<br>13.5px x11<br>20px x9<br>16px x5<br>17px x3<br>19px x3<br>22px x1 | 22.5px x12<br>18px x6<br>20px x3<br>21px x1 |
| letterSpacing (1 vs 1) | normal x45 | normal x22 |
| color (5 vs 4) | rgba(255, 255, 255, 0.93) x23<br>oklab(0.999994 0.0000455678 0.0000200868 / 0.929412) x11<br>rgba(255, 255, 255, 0.57) x6<br>rgba(255, 255, 255, 0.4) x4<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x15<br>rgb(180, 186, 179) x4<br>rgb(163, 170, 164) x2<br>rgb(22, 26, 23) x1 |
| backgroundColor (8 vs 9) | rgba(255, 255, 255, 0.075) x11<br>rgb(25, 25, 25) x7<br>hsl(none 0% 9.80392%) x1<br>color(srgb 0.0980392 0.0980392 0.0980392 / 0.85) x1<br>hsl(none 0% 100% / 0.05) x1<br>oklab(0.239291 0.0000108778 0.00000478327 / 0.8) x1<br>rgb(48, 48, 48) x1<br>rgba(255, 255, 255, 0.05) x1 | rgb(38, 44, 39) x5<br>rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1<br>rgb(42, 48, 43) x1 |
| borderTopLeftRadius (6 vs 4) | 8px x42<br>4px x11<br>6px x9<br>12px x1<br>2.68435e+07px x1<br>14px x1 | 8px x8<br>12px x5<br>3.35544e+07px x4<br>14px x2 |
| boxShadow (3 vs 2) | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, rgba(0, 0, 0,  x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgb(25, 25, 25) 0px 0px 0px 32px x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (1 vs 2) | rgba(255, 255, 255, 0.04) x1 | rgba(0, 0, 0, 0) x7<br>rgb(107, 114, 108) x1 |
| borderTopWidth (1 vs 1) | 0.8px x1 | 1px x8 |
| paddingTop (9 vs 5) | 1px x11<br>8px x4<br>5px x3<br>4px x2<br>56px x1<br>12px x1<br>5.5px x1<br>1.875px x1<br>24px x1 | 8px x5<br>2px x3<br>14px x1<br>6px x1<br>12px x1 |
| paddingLeft (11 vs 8) | 4px x15<br>8px x11<br>12px x4<br>6px x4<br>7.5px x4<br>20px x1<br>16px x1<br>30px x1<br>3px x1<br>1px x1<br>32px x1 | 12px x6<br>2px x3<br>9px x2<br>56px x1<br>10px x1<br>16px x1<br>4px x1<br>14px x1 |
| rowGap (4 vs 4) | 4px x25<br>6px x15<br>8px x10<br>20px x1 | 8px x19<br>4px x13<br>6px x3<br>2px x2 |
| columnGap (4 vs 5) | 4px x25<br>6px x15<br>8px x8<br>20px x1 | 8px x18<br>4px x13<br>6px x3<br>2px x2<br>10px x1 |
| transitionDuration (8 vs 1) | 0.06s x35<br>0.45s x13<br>0.2s x7<br>0.12s x3<br>0.28s x2<br>0.5s x1<br>0.15s x1<br>0.12s, 0s x1 | 0.15s x2 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x25<br>cubic-bezier(0.165, 0.84, 0.44, 1) x22<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x13<br>ease-out x1<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (1 vs 0) | task-grid-fade-in, task-grid-clip-reveal x1 |  |
| strokeWidth (1 vs 2) | 1.25px x1 | 1.75px x23<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## chat-long / jump-to-latest

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 240 vs 140

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 17, 169.2x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 12px | 9px |
| button.primary | paddingLeft | 12px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | text | default |
| composer.box | count, size | 1, 343.2x48 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.22) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 19px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | marginTop | -4px | 0px |
| composer.button | marginBottom | -4px | 0px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 281.2x22 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | count, size | 1, 36x36 | 1, 32x32 |
| jump | fontFamily | anthropic-sans | instrumentSans |
| jump | fontWeight | 400 | 500 |
| jump | lineHeight | 21px | 20px |
| jump | whiteSpace | normal | nowrap |
| jump | color | rgba(255, 255, 255, 0.93) | rgb(180, 186, 179) |
| jump | backgroundColor | oklab(0.239291 0.0000108778 0.00000478327 / 0.8) | rgb(34, 39, 35) |
| jump | borderTopWidth | 0.8px | 0px |
| jump | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderRightWidth | 0.8px | 0px |
| jump | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderBottomWidth | 0.8px | 0px |
| jump | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderLeftWidth | 0.8px | 0px |
| jump | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderTopLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderTopRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | boxShadow | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, rgba(0, 0, 0, 0.24) 0px 6px 16px 0px | none |
| jump | outlineWidth | 1.6px | 3px |
| jump | outlineStyle | solid | none |
| jump | outlineColor | rgba(81, 156, 237, 0) | rgb(180, 186, 179) |
| jump | outlineOffset | 1.6px | 0px |
| jump | paddingTop | 4px | 0px |
| jump | paddingRight | 4px | 0px |
| jump | paddingBottom | 4px | 0px |
| jump | paddingLeft | 4px | 0px |
| jump | transitionProperty | opacity, border-color | opacity |
| jump | transitionDuration | 0.2s | 0s |
| jump | cursor | pointer | default |
| jump | backdropFilter | blur(8px) | none |
| jump | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(255, 255, 255, 0.93)","radius":"0p | null |
| message.actions.button | count, size | 3, 32x32 | 9, 24x24 |
| message.actions.button | position | relative | static |
| message.actions.button | fontFamily | anthropic-sans | instrumentSans |
| message.actions.button | fontSize | 13px | 14px |
| message.actions.button | fontWeight | 435 | 500 |
| message.actions.button | lineHeight | 19px | 20px |
| message.actions.button | color | rgba(255, 255, 255, 0.57) | rgb(163, 170, 164) |
| message.actions.button | borderTopStyle | solid | none |
| message.actions.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| message.actions.button | borderRightStyle | solid | none |
| message.actions.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| message.actions.button | borderBottomStyle | solid | none |
| message.actions.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| message.actions.button | borderLeftStyle | solid | none |
| message.actions.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| message.actions.button | borderTopLeftRadius | 6px | 0px |
| message.actions.button | borderTopRightRadius | 6px | 0px |
| message.actions.button | borderBottomRightRadius | 6px | 0px |
| message.actions.button | borderBottomLeftRadius | 6px | 0px |
| message.actions.button | outlineWidth | 1.6px | 3px |
| message.actions.button | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| message.actions.button | outlineOffset | 1.6px | 0px |
| message.actions.button | marginTop | -4px | 0px |
| message.actions.button | marginBottom | -4px | 0px |
| message.actions.button | rowGap | 6px | normal |
| message.actions.button | columnGap | 6px | normal |
| message.actions.button | transitionProperty | box-shadow | all |
| message.actions.button | transitionDuration | 0.06s | 0s |
| message.reply | presence | absent | 3 |
| message.reply.p | presence | absent | 3 |
| message.user | presence | absent | 3 |
| message.user.bubble | presence | absent | 3 |
| project.card | presence | absent | 1 |
| shell.header | presence | absent | 1 |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 1) | Anthropicons-Variable x14<br>anthropic-sans x9<br>anthropic-serif x8<br>anthropic-mono x3 | instrumentSans x17 |
| fontSize (7 vs 3) | 16px x8<br>15px x8<br>20px x7<br>13px x4<br>13.5px x3<br>14px x2<br>11px x2 | 15px x7<br>13px x6<br>14px x4 |
| fontWeight (5 vs 3) | 400 x10<br>433.25 x7<br>533.25 x7<br>435 x5<br>600 x5 | 450 x11<br>600 x3<br>500 x3 |
| lineHeight (7 vs 4) | 20px x9<br>21px x8<br>16px x7<br>13.5px x3<br>17px x3<br>19px x3<br>22px x1 | 22.5px x7<br>18px x6<br>20px x3<br>21px x1 |
| letterSpacing (1 vs 1) | normal x34 | normal x17 |
| color (5 vs 4) | rgba(255, 255, 255, 0.93) x19<br>rgba(255, 255, 255, 0.57) x7<br>rgba(255, 255, 255, 0.4) x4<br>oklab(0.999994 0.0000455678 0.0000200868 / 0.929412) x3<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x10<br>rgb(180, 186, 179) x4<br>rgb(163, 170, 164) x2<br>rgb(22, 26, 23) x1 |
| backgroundColor (7 vs 9) | rgb(25, 25, 25) x7<br>rgba(255, 255, 255, 0.075) x3<br>hsl(none 0% 9.80392%) x1<br>color(srgb 0.0980392 0.0980392 0.0980392 / 0.85) x1<br>oklab(0.239291 0.0000108778 0.00000478327 / 0.8) x1<br>rgb(48, 48, 48) x1<br>rgba(255, 255, 255, 0.05) x1 | rgb(38, 44, 39) x3<br>rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1<br>rgb(42, 48, 43) x1 |
| borderTopLeftRadius (5 vs 4) | 8px x40<br>6px x15<br>4px x3<br>2.68435e+07px x1<br>14px x1 | 8px x8<br>3.35544e+07px x4<br>12px x3<br>14px x2 |
| boxShadow (3 vs 2) | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, rgba(0, 0, 0,  x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgb(25, 25, 25) 0px 0px 0px 32px x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (1 vs 2) | rgba(255, 255, 255, 0.04) x1 | rgba(0, 0, 0, 0) x7<br>rgb(107, 114, 108) x1 |
| borderTopWidth (1 vs 1) | 0.8px x1 | 1px x8 |
| paddingTop (6 vs 5) | 8px x4<br>4px x3<br>1px x3<br>5px x3<br>56px x1<br>24px x1 | 8px x3<br>2px x3<br>14px x1<br>6px x1<br>12px x1 |
| paddingLeft (10 vs 8) | 8px x10<br>4px x7<br>12px x4<br>7.5px x4<br>6px x4<br>20px x1<br>30px x1<br>3px x1<br>1px x1<br>32px x1 | 12px x4<br>2px x3<br>9px x2<br>56px x1<br>10px x1<br>16px x1<br>4px x1<br>14px x1 |
| rowGap (4 vs 4) | 4px x27<br>6px x17<br>8px x5<br>20px x1 | 8px x12<br>4px x8<br>6px x3<br>2px x2 |
| columnGap (4 vs 5) | 4px x27<br>6px x17<br>8px x3<br>20px x1 | 8px x11<br>4px x8<br>6px x3<br>2px x2<br>10px x1 |
| transitionDuration (9 vs 1) | 0.06s x39<br>0.45s x15<br>0.2s x8<br>0.12s x2<br>0.28s x2<br>0.5s x1<br>0.3s x1<br>0.15s x1<br>0.12s, 0s x1 | 0.15s x2 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x27<br>cubic-bezier(0.165, 0.84, 0.44, 1) x25<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x15<br>ease-out x1<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (1 vs 0) | task-grid-fade-in, task-grid-clip-reveal x1 |  |
| strokeWidth (2 vs 2) | 1px x1<br>1.25px x1 | 1.75px x17<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## chat-long / hover-code-block

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 274 vs 187

| role | prop | claude.ai | cairn |
|---|---|---|---|
| blockquote | presence | 1 | absent |
| button.primary | count, size | 13, 169.2x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 12px | 9px |
| button.primary | paddingLeft | 12px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | text | default |
| code.block | presence | 1 | absent |
| code.block.box | presence | 1 | absent |
| composer.box | count, size | 1, 343.2x48 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.22) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 19px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | marginTop | -4px | 0px |
| composer.button | marginBottom | -4px | 0px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 281.2x22 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | count, size | 1, 36x36 | 1, 32x32 |
| jump | fontFamily | anthropic-sans | instrumentSans |
| jump | fontWeight | 400 | 500 |
| jump | lineHeight | 21px | 20px |
| jump | whiteSpace | normal | nowrap |
| jump | color | rgba(255, 255, 255, 0.93) | rgb(180, 186, 179) |
| jump | backgroundColor | oklab(0.239291 0.0000108778 0.00000478327 / 0.8) | rgb(34, 39, 35) |
| jump | borderTopWidth | 0.8px | 0px |
| jump | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderRightWidth | 0.8px | 0px |
| jump | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderBottomWidth | 0.8px | 0px |
| jump | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderLeftWidth | 0.8px | 0px |
| jump | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderTopLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderTopRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | boxShadow | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, rgba(0, 0, 0, 0.24) 0px 6px 16px 0px | none |
| jump | outlineWidth | 1.6px | 3px |
| jump | outlineStyle | solid | none |
| jump | outlineColor | rgba(81, 156, 237, 0) | rgb(180, 186, 179) |
| jump | outlineOffset | 1.6px | 0px |
| jump | paddingTop | 4px | 0px |
| jump | paddingRight | 4px | 0px |
| jump | paddingBottom | 4px | 0px |
| jump | paddingLeft | 4px | 0px |
| jump | transitionProperty | opacity, border-color | opacity |
| jump | transitionDuration | 0.2s | 0s |
| jump | cursor | pointer | default |
| jump | backdropFilter | blur(8px) | none |
| jump | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(255, 255, 255, 0.93)","radius":"0p | null |
| message.actions.button | presence | absent | 15 |
| message.reply | presence | absent | 5 |
| message.reply.p | presence | absent | 5 |
| message.user | presence | absent | 5 |
| message.user.bubble | presence | absent | 5 |
| project.card | presence | absent | 1 |
| shell.header | presence | absent | 1 |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |
| table.td | presence | 12 | absent |
| table.th | presence | 4 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 1) | anthropic-mono x44<br>anthropic-serif x22<br>Anthropicons-Variable x10<br>anthropic-sans x8 | instrumentSans x21 |
| fontSize (7 vs 3) | 14px x38<br>15px x22<br>20px x8<br>13.5px x8<br>13px x4<br>16px x3<br>11px x1 | 15px x11<br>13px x6<br>14px x4 |
| fontWeight (5 vs 3) | 400 x63<br>433.25 x8<br>600 x6<br>435 x5<br>533.25 x2 | 450 x15<br>600 x3<br>500 x3 |
| lineHeight (8 vs 4) | 22.75px x36<br>21px x22<br>20px x10<br>13.5px x8<br>19px x3<br>16px x2<br>17px x2<br>22px x1 | 22.5px x11<br>18px x6<br>20px x3<br>21px x1 |
| letterSpacing (1 vs 1) | normal x84 | normal x21 |
| color (10 vs 4) | rgba(255, 255, 255, 0.93) x33<br>rgb(211, 215, 222) x18<br>rgb(94, 237, 237) x11<br>oklab(0.999994 0.0000455678 0.0000200868 / 0.929412) x8<br>rgb(234, 236, 240) x3<br>rgba(255, 255, 255, 0.57) x3<br>rgba(255, 255, 255, 0.4) x3<br>rgb(112, 184, 255) x2<br>rgb(129, 136, 152) x2<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x14<br>rgb(180, 186, 179) x4<br>rgb(163, 170, 164) x2<br>rgb(22, 26, 23) x1 |
| backgroundColor (8 vs 9) | rgba(255, 255, 255, 0.075) x8<br>rgb(25, 25, 25) x7<br>hsl(none 0% 9.80392%) x1<br>color(srgb 0.0980392 0.0980392 0.0980392 / 0.85) x1<br>oklab(0.239291 0.0000108778 0.00000478327 / 0.5) x1<br>oklab(0.239291 0.0000108778 0.00000478327 / 0.8) x1<br>rgb(48, 48, 48) x1<br>rgba(255, 255, 255, 0.05) x1 | rgb(38, 44, 39) x5<br>rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1<br>rgb(42, 48, 43) x1 |
| borderTopLeftRadius (5 vs 4) | 8px x43<br>4px x8<br>12px x2<br>2.68435e+07px x1<br>14px x1 | 8px x8<br>12px x5<br>3.35544e+07px x4<br>14px x2 |
| boxShadow (3 vs 2) | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, rgba(0, 0, 0,  x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgb(25, 25, 25) 0px 0px 0px 32px x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (2 vs 2) | rgba(255, 255, 255, 0.1) x8<br>rgba(255, 255, 255, 0.04) x2 | rgba(0, 0, 0, 0) x7<br>rgb(107, 114, 108) x1 |
| borderTopWidth (1 vs 1) | 0.8px x10 | 1px x8 |
| paddingTop (8 vs 5) | 7.5625px x16<br>1px x8<br>8px x4<br>5px x3<br>4px x2<br>56px x1<br>14px x1<br>24px x1 | 8px x5<br>2px x3<br>14px x1<br>6px x1<br>12px x1 |
| paddingLeft (11 vs 8) | 4px x13<br>22.5px x12<br>8px x11<br>12px x4<br>6px x3<br>20px x1<br>14px x1<br>15px x1<br>3px x1<br>1px x1<br>32px x1 | 12px x6<br>2px x3<br>9px x2<br>56px x1<br>10px x1<br>16px x1<br>4px x1<br>14px x1 |
| rowGap (4 vs 4) | 4px x23<br>6px x13<br>8px x4<br>20px x1 | 8px x18<br>4px x12<br>6px x3<br>2px x2 |
| columnGap (4 vs 5) | 4px x23<br>6px x13<br>8px x3<br>20px x1 | 8px x17<br>4px x12<br>6px x3<br>2px x2<br>10px x1 |
| transitionDuration (8 vs 1) | 0.06s x30<br>0.45s x11<br>0.2s x7<br>0.12s x3<br>0.28s x2<br>0.5s x1<br>0.15s x1<br>0.12s, 0s x1 | 0.15s x2 |
| transitionTimingFunction (5 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x23<br>cubic-bezier(0.165, 0.84, 0.44, 1) x20<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x11<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (1 vs 0) | task-grid-fade-in, task-grid-clip-reveal x1 |  |
| strokeWidth (1 vs 2) | 1.25px x1 | 1.75px x23<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## chat-long / open-side-panel

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 297 vs 233

| role | prop | claude.ai | cairn |
|---|---|---|---|
| blockquote | presence | 1 | absent |
| button.primary | count, size | 14, 169.2x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 12px | 9px |
| button.primary | paddingLeft | 12px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | text | default |
| code.block | presence | 1 | absent |
| code.block.box | presence | 1 | absent |
| composer.box | count, size | 1, 343.2x48 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.22) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 19px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | marginTop | -4px | 0px |
| composer.button | marginBottom | -4px | 0px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 281.2x22 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | count, size | 1, 36x36 | 2, 32x32 |
| jump | fontFamily | anthropic-sans | instrumentSans |
| jump | fontWeight | 400 | 500 |
| jump | lineHeight | 21px | 20px |
| jump | whiteSpace | normal | nowrap |
| jump | color | rgba(255, 255, 255, 0.93) | rgb(180, 186, 179) |
| jump | backgroundColor | oklab(0.239291 0.0000108778 0.00000478327 / 0.8) | rgb(34, 39, 35) |
| jump | borderTopWidth | 0.8px | 0px |
| jump | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderRightWidth | 0.8px | 0px |
| jump | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderBottomWidth | 0.8px | 0px |
| jump | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderLeftWidth | 0.8px | 0px |
| jump | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| jump | borderTopLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderTopRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | boxShadow | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, rgba(0, 0, 0, 0.24) 0px 6px 16px 0px | none |
| jump | outlineWidth | 1.6px | 3px |
| jump | outlineStyle | solid | none |
| jump | outlineColor | rgba(81, 156, 237, 0) | rgb(180, 186, 179) |
| jump | outlineOffset | 1.6px | 0px |
| jump | paddingTop | 4px | 0px |
| jump | paddingRight | 4px | 0px |
| jump | paddingBottom | 4px | 0px |
| jump | paddingLeft | 4px | 0px |
| jump | transitionProperty | opacity, border-color | opacity |
| jump | transitionDuration | 0.2s | 0s |
| jump | cursor | pointer | default |
| jump | backdropFilter | blur(8px) | none |
| jump | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(255, 255, 255, 0.93)","radius":"0p | null |
| message.actions.button | presence | absent | 15 |
| message.reply | presence | absent | 5 |
| message.reply.p | presence | absent | 5 |
| message.user | presence | absent | 5 |
| message.user.bubble | presence | absent | 5 |
| project.card | presence | absent | 1 |
| shell.header | presence | absent | 2 |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | count, size | 2, 32x32 | 1, 375x812 |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | backgroundColor | rgba(0, 0, 0, 0) | rgb(27, 31, 28) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | boxShadow | none | rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0, 0.6) 0px 24px 48px -12px, rgba(255, 255 |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.sidebar | transitionProperty | none | all |
| shell.sidebar | animationName | none | side-panel-in |
| shell.sidebar | animationDuration | 0s | 0.22s |
| shell.sidebar | animationTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.section | presence | 1 | absent |
| table.td | presence | 12 | absent |
| table.th | presence | 4 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 1) | anthropic-mono x44<br>anthropic-serif x22<br>Anthropicons-Variable x11<br>anthropic-sans x10 | instrumentSans x29 |
| fontSize (8 vs 4) | 14px x39<br>15px x22<br>20px x8<br>13.5px x8<br>13px x5<br>16px x3<br>11px x1<br>18px x1 | 15px x12<br>13px x9<br>14px x7<br>12px x1 |
| fontWeight (6 vs 3) | 400 x64<br>433.25 x8<br>435 x6<br>600 x6<br>533.25 x2<br>492.5 x1 | 450 x19<br>500 x6<br>600 x4 |
| lineHeight (9 vs 5) | 22.75px x36<br>21px x22<br>20px x11<br>13.5px x8<br>17px x3<br>19px x3<br>16px x2<br>22px x1<br>18px x1 | 22.5px x12<br>18px x9<br>20px x6<br>21px x1<br>16px x1 |
| letterSpacing (1 vs 1) | normal x87 | normal x29 |
| color (10 vs 4) | rgba(255, 255, 255, 0.93) x34<br>rgb(211, 215, 222) x18<br>rgb(94, 237, 237) x11<br>oklab(0.999994 0.0000455678 0.0000200868 / 0.929412) x8<br>rgba(255, 255, 255, 0.57) x5<br>rgb(234, 236, 240) x3<br>rgba(255, 255, 255, 0.4) x3<br>rgb(112, 184, 255) x2<br>rgb(129, 136, 152) x2<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x17<br>rgb(180, 186, 179) x6<br>rgb(163, 170, 164) x5<br>rgb(22, 26, 23) x1 |
| backgroundColor (11 vs 10) | rgba(255, 255, 255, 0.075) x8<br>rgb(25, 25, 25) x7<br>hsl(none 0% 9.80392%) x1<br>rgba(255, 255, 255, 0.15) x1<br>color(srgb 0.0980392 0.0980392 0.0980392 / 0.85) x1<br>oklab(0.239291 0.0000108778 0.00000478327 / 0.5) x1<br>oklab(0.239291 0.0000108778 0.00000478327 / 0.8) x1<br>rgb(48, 48, 48) x1<br>rgba(255, 255, 255, 0.05) x1<br>rgba(0, 0, 0, 0.5) x1<br>rgb(31, 31, 31) x1 | rgb(38, 44, 39) x5<br>rgb(34, 39, 35) x5<br>rgb(42, 48, 43) x3<br>rgb(27, 31, 28) x2<br>rgb(20, 23, 21) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1<br>rgba(0, 0, 0, 0.5) x1 |
| borderTopLeftRadius (6 vs 4) | 8px x43<br>4px x8<br>12px x4<br>7px x3<br>2.68435e+07px x1<br>14px x1 | 8px x14<br>3.35544e+07px x5<br>12px x5<br>14px x3 |
| boxShadow (4 vs 3) | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, rgba(0, 0, 0,  x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgb(25, 25, 25) 0px 0px 0px 32px x1<br>rgba(0, 0, 0, 0.05) 0px 1px 2px 0px x1 | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x2<br>rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0, 0.6) 0px  x1 |
| borderTopColor (2 vs 3) | rgba(255, 255, 255, 0.1) x8<br>rgba(255, 255, 255, 0.04) x3 | rgba(0, 0, 0, 0) x9<br>rgb(107, 114, 108) x1<br>rgb(53, 59, 54) x1 |
| borderTopWidth (1 vs 1) | 0.8px x11 | 1px x11 |
| paddingTop (9 vs 7) | 7.5625px x16<br>1px x8<br>8px x4<br>5px x3<br>4px x2<br>56px x1<br>14px x1<br>24px x1<br>48px x1 | 8px x5<br>2px x5<br>12px x3<br>14px x1<br>6px x1<br>10px x1<br>20px x1 |
| paddingLeft (10 vs 10) | 4px x13<br>22.5px x12<br>8px x11<br>12px x5<br>6px x3<br>20px x1<br>14px x1<br>15px x1<br>3px x1<br>1px x1 | 12px x6<br>2px x5<br>16px x3<br>9px x2<br>14px x2<br>20px x2<br>56px x1<br>10px x1<br>4px x1<br>6px x1 |
| rowGap (6 vs 4) | 4px x24<br>6px x14<br>8px x4<br>20px x1<br>12px x1<br>16px x1 | 8px x20<br>4px x14<br>6px x7<br>2px x4 |
| columnGap (6 vs 5) | 4px x24<br>6px x14<br>8px x3<br>20px x1<br>12px x1<br>16px x1 | 8px x19<br>4px x14<br>6px x7<br>2px x4<br>10px x1 |
| transitionDuration (8 vs 1) | 0.06s x32<br>0.45s x12<br>0.2s x7<br>0.12s x3<br>0.28s x2<br>0.5s x1<br>0.15s x1<br>0.12s, 0s x1 | 0.15s x6 |
| transitionTimingFunction (5 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x24<br>cubic-bezier(0.165, 0.84, 0.44, 1) x21<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x12<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x5<br>cubic-bezier(0.2, 0, 0, 1) x1 |
| animationName (3 vs 2) | task-grid-fade-in, task-grid-clip-reveal x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1<br>cds-flipbook x1 | side-panel-scrim-in x1<br>side-panel-in x1 |
| strokeWidth (2 vs 2) | 1.25px x1<br>1px x1 | 1.75px x28<br>1px x2 |

root custom properties: claude.ai 1383, cairn 72

## send-stream / initial

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 235 vs 106

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 14, 32x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| composer.box | count, size | 1, 343.2x88 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.36) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x22 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgb(156, 199, 139) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 1 |
| message.reply.p | presence | absent | 1 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 1) | Anthropicons-Variable x12<br>anthropic-sans x11<br>anthropic-serif x1 | instrumentSans x16 |
| fontSize (6 vs 3) | 20px x6<br>13px x6<br>16px x4<br>12px x4<br>14px x3<br>24px x1 | 13px x8<br>14px x5<br>15px x3 |
| fontWeight (6 vs 3) | 433.25 x6<br>400 x6<br>435 x5<br>533.25 x3<br>577.75 x3<br>360 x1 | 450 x10<br>600 x3<br>500 x3 |
| lineHeight (8 vs 5) | 20px x8<br>16px x5<br>19px x4<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>17px x1 | 18px x7<br>20px x4<br>22.5px x3<br>24px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x24 | normal x16 |
| color (4 vs 4) | rgba(255, 255, 255, 0.93) x14<br>rgba(255, 255, 255, 0.57) x6<br>rgba(255, 255, 255, 0.4) x3<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x6<br>rgb(163, 170, 164) x5<br>rgb(180, 186, 179) x4<br>rgb(22, 26, 23) x1 |
| backgroundColor (7 vs 10) | hsl(none 0% 100% / 0.1) x8<br>rgb(25, 25, 25) x6<br>rgb(31, 31, 31) x2<br>rgb(11, 11, 11) x2<br>hsl(none 0% 9.80392%) x1<br>rgb(48, 48, 48) x1<br>rgba(255, 255, 255, 0.05) x1 | rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(38, 44, 39) x1<br>rgb(163, 170, 164) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1<br>rgb(42, 48, 43) x1 |
| borderTopLeftRadius (5 vs 4) | 8px x41<br>7px x12<br>6px x9<br>11px x8<br>14px x1 | 8px x10<br>3.35544e+07px x5<br>14px x2<br>12px x1 |
| boxShadow (3 vs 2) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 100% / 0.1) 0px 0px 0px 1px x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (1 vs 2) | hsl(none 0% 100% / 0.2) x2 | rgba(0, 0, 0, 0) x7<br>rgb(107, 114, 108) x1 |
| borderTopWidth (1 vs 1) | 0.8px x2 | 1px x8 |
| paddingTop (6 vs 5) | 8px x7<br>5px x3<br>14px x2<br>4px x2<br>16px x1<br>12px x1 | 2px x5<br>14px x1<br>8px x1<br>6px x1<br>12px x1 |
| paddingLeft (6 vs 8) | 8px x14<br>12px x5<br>4px x4<br>14px x2<br>23.04px x1<br>1px x1 | 2px x3<br>12px x2<br>9px x2<br>56px x1<br>10px x1<br>16px x1<br>4px x1<br>14px x1 |
| rowGap (8 vs 4) | 4px x20<br>6px x17<br>8px x7<br>24px x1<br>28px x1<br>2px x1<br>5px x1<br>12px x1 | 8px x7<br>4px x6<br>6px x3<br>2px x2 |
| columnGap (8 vs 5) | 4px x20<br>6px x17<br>8px x5<br>24px x1<br>28px x1<br>2px x1<br>5px x1<br>12px x1 | 8px x6<br>4px x6<br>6px x3<br>2px x2<br>10px x1 |
| transitionDuration (8 vs 1) | 0.06s x35<br>0.45s x17<br>0.2s x10<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1<br>0.15s x1 | 0.15s x2 |
| transitionTimingFunction (5 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x26<br>cubic-bezier(0.165, 0.84, 0.44, 1) x25<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x17<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (2 vs 2) | static-composer-actions-fade-in x4<br>task-grid-fade-in, task-grid-clip-reveal x1 | shimmer-sweep x1<br>live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x11<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## send-stream / send

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 169 vs 106

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 32x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| composer.box | count, size | 1, 343.2x176 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.36) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginRight | 0px | 16px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | marginLeft | 0px | 16px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x110 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgba(255, 255, 255, 0.93) | rgb(156, 199, 139) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 1 |
| message.reply.p | presence | absent | 1 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 1) | Anthropicons-Variable x9<br>anthropic-sans x5<br>anthropic-serif x1 | instrumentSans x16 |
| fontSize (6 vs 3) | 20px x5<br>13px x3<br>12px x3<br>16px x2<br>14px x1<br>24px x1 | 13px x8<br>14px x5<br>15px x3 |
| fontWeight (6 vs 3) | 433.25 x5<br>435 x3<br>577.75 x3<br>400 x2<br>360 x1<br>533.25 x1 | 450 x10<br>600 x3<br>500 x3 |
| lineHeight (7 vs 5) | 20px x5<br>19px x3<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>16px x1 | 18px x7<br>20px x4<br>22.5px x3<br>24px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x15 | normal x16 |
| color (3 vs 4) | rgba(255, 255, 255, 0.93) x11<br>rgba(255, 255, 255, 0.57) x3<br>rgb(255, 255, 255) x1 | rgb(230, 232, 226) x6<br>rgb(163, 170, 164) x5<br>rgb(180, 186, 179) x4<br>rgb(22, 26, 23) x1 |
| backgroundColor (4 vs 10) | rgb(25, 25, 25) x2<br>hsl(none 0% 9.80392%) x1<br>rgb(48, 48, 48) x1<br>rgb(198, 97, 63) x1 | rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(38, 44, 39) x1<br>rgb(163, 170, 164) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1<br>rgb(42, 48, 43) x1 |
| borderTopLeftRadius (2 vs 4) | 8px x38<br>14px x1 | 8px x10<br>3.35544e+07px x5<br>14px x2<br>12px x1 |
| boxShadow (1 vs 2) | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(255, 255, 2 x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (0 vs 2) |  | rgba(0, 0, 0, 0) x7<br>rgb(107, 114, 108) x1 |
| borderTopWidth (0 vs 1) |  | 1px x8 |
| paddingTop (3 vs 5) | 8px x4<br>5px x2<br>16px x1 | 2px x5<br>14px x1<br>8px x1<br>6px x1<br>12px x1 |
| paddingLeft (5 vs 8) | 8px x10<br>4px x2<br>12px x2<br>23.04px x1<br>1px x1 | 2px x3<br>12px x2<br>9px x2<br>56px x1<br>10px x1<br>16px x1<br>4px x1<br>14px x1 |
| rowGap (6 vs 4) | 4px x17<br>6px x13<br>8px x7<br>24px x1<br>28px x1<br>2px x1 | 8px x7<br>4px x6<br>6px x3<br>2px x2 |
| columnGap (6 vs 5) | 4px x17<br>6px x13<br>8px x5<br>24px x1<br>28px x1<br>2px x1 | 8px x6<br>4px x6<br>6px x3<br>2px x2<br>10px x1 |
| transitionDuration (7 vs 1) | 0.06s x28<br>0.45s x10<br>0.2s x4<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x2 |
| transitionTimingFunction (5 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x20<br>cubic-bezier(0.165, 0.84, 0.44, 1) x17<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x10<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (1 vs 2) | task-grid-fade-in, task-grid-clip-reveal x1 | shimmer-sweep x1<br>live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x11<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## send-stream / stream

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 169 vs 106

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 32x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| composer.box | count, size | 1, 343.2x176 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.36) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginRight | 0px | 16px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | marginLeft | 0px | 16px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x110 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgba(255, 255, 255, 0.93) | rgb(156, 199, 139) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 1 |
| message.reply.p | presence | absent | 1 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 1) | Anthropicons-Variable x9<br>anthropic-sans x5<br>anthropic-serif x1 | instrumentSans x16 |
| fontSize (6 vs 3) | 20px x5<br>13px x3<br>12px x3<br>16px x2<br>14px x1<br>24px x1 | 13px x8<br>14px x5<br>15px x3 |
| fontWeight (6 vs 3) | 433.25 x5<br>435 x3<br>577.75 x3<br>400 x2<br>360 x1<br>533.25 x1 | 450 x10<br>600 x3<br>500 x3 |
| lineHeight (7 vs 5) | 20px x5<br>19px x3<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>16px x1 | 18px x7<br>20px x4<br>22.5px x3<br>24px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x15 | normal x16 |
| color (3 vs 4) | rgba(255, 255, 255, 0.93) x11<br>rgba(255, 255, 255, 0.57) x3<br>rgb(255, 255, 255) x1 | rgb(230, 232, 226) x6<br>rgb(163, 170, 164) x5<br>rgb(180, 186, 179) x4<br>rgb(22, 26, 23) x1 |
| backgroundColor (4 vs 10) | rgb(25, 25, 25) x2<br>hsl(none 0% 9.80392%) x1<br>rgb(48, 48, 48) x1<br>rgb(198, 97, 63) x1 | rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(38, 44, 39) x1<br>rgb(163, 170, 164) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1<br>rgb(42, 48, 43) x1 |
| borderTopLeftRadius (2 vs 4) | 8px x38<br>14px x1 | 8px x10<br>3.35544e+07px x5<br>14px x2<br>12px x1 |
| boxShadow (1 vs 2) | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(255, 255, 2 x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (0 vs 2) |  | rgba(0, 0, 0, 0) x7<br>rgb(107, 114, 108) x1 |
| borderTopWidth (0 vs 1) |  | 1px x8 |
| paddingTop (3 vs 5) | 8px x4<br>5px x2<br>16px x1 | 2px x5<br>14px x1<br>8px x1<br>6px x1<br>12px x1 |
| paddingLeft (5 vs 8) | 8px x10<br>4px x2<br>12px x2<br>23.04px x1<br>1px x1 | 2px x3<br>12px x2<br>9px x2<br>56px x1<br>10px x1<br>16px x1<br>4px x1<br>14px x1 |
| rowGap (6 vs 4) | 4px x17<br>6px x13<br>8px x7<br>24px x1<br>28px x1<br>2px x1 | 8px x7<br>4px x6<br>6px x3<br>2px x2 |
| columnGap (6 vs 5) | 4px x17<br>6px x13<br>8px x5<br>24px x1<br>28px x1<br>2px x1 | 8px x6<br>4px x6<br>6px x3<br>2px x2<br>10px x1 |
| transitionDuration (7 vs 1) | 0.06s x28<br>0.45s x10<br>0.2s x4<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x2 |
| transitionTimingFunction (5 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x20<br>cubic-bezier(0.165, 0.84, 0.44, 1) x17<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x10<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (1 vs 2) | task-grid-fade-in, task-grid-clip-reveal x1 | shimmer-sweep x1<br>live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x11<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## search-palette / initial

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 170 vs 136

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 32x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x242 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.36) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x176 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgb(156, 199, 139) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | Anthropicons-Variable x9<br>anthropic-sans x5<br>anthropic-serif x1 | instrumentSans x37<br>jetbrainsMono x2 |
| fontSize (6 vs 5) | 20px x5<br>13px x3<br>12px x3<br>16px x2<br>14px x1<br>24px x1 | 14px x26<br>13px x8<br>15px x2<br>12px x2<br>17px x1 |
| fontWeight (6 vs 4) | 433.25 x5<br>435 x3<br>577.75 x3<br>400 x2<br>360 x1<br>533.25 x1 | 450 x27<br>500 x5<br>600 x4<br>700 x3 |
| lineHeight (7 vs 7) | 20px x5<br>19px x3<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>16px x1 | 24px x23<br>18px x6<br>20px x4<br>22.5px x2<br>16.8px x2<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x15 | normal x39 |
| color (3 vs 5) | rgba(255, 255, 255, 0.93) x11<br>rgba(255, 255, 255, 0.57) x3<br>rgb(255, 255, 255) x1 | rgb(230, 232, 226) x24<br>rgb(163, 170, 164) x8<br>rgb(180, 186, 179) x5<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1 |
| backgroundColor (4 vs 11) | rgb(25, 25, 25) x2<br>hsl(none 0% 9.80392%) x1<br>rgb(48, 48, 48) x1<br>rgb(198, 97, 63) x1 | rgb(42, 48, 43) x4<br>rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(38, 44, 39) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgb(163, 170, 164) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1 |
| borderTopLeftRadius (2 vs 5) | 8px x38<br>14px x1 | 8px x8<br>3.35544e+07px x5<br>4px x3<br>12px x2<br>14px x2 |
| boxShadow (1 vs 2) | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (0 vs 3) |  | rgba(0, 0, 0, 0) x7<br>rgb(53, 59, 54) x1<br>rgb(107, 114, 108) x1 |
| borderTopWidth (0 vs 1) |  | 1px x9 |
| paddingTop (3 vs 6) | 8px x4<br>5px x2<br>16px x1 | 1px x3<br>2px x3<br>8px x2<br>14px x1<br>6px x1<br>12px x1 |
| paddingLeft (5 vs 9) | 8px x10<br>4px x2<br>12px x2<br>23.04px x1<br>1px x1 | 2px x3<br>10px x2<br>12px x2<br>4px x2<br>6px x2<br>9px x2<br>56px x1<br>16px x1<br>14px x1 |
| rowGap (6 vs 4) | 4px x17<br>6px x13<br>8px x7<br>24px x1<br>28px x1<br>2px x1 | 8px x13<br>4px x5<br>2px x4<br>6px x3 |
| columnGap (6 vs 5) | 4px x17<br>6px x13<br>8px x5<br>24px x1<br>28px x1<br>2px x1 | 8px x12<br>4px x5<br>2px x4<br>6px x3<br>10px x1 |
| transitionDuration (7 vs 1) | 0.06s x28<br>0.45s x10<br>0.2s x4<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x2 |
| transitionTimingFunction (5 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x20<br>cubic-bezier(0.165, 0.84, 0.44, 1) x17<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x10<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (2 vs 1) | static-composer-actions-fade-in x3<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x11<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## search-palette / open-palette

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 282 vs 168

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 32x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x242 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.22) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x176 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| dialog | count, size | 1, 343.2x544.8 | 1, 343x250 |
| dialog | display | block | flex |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontSize | 16px | 14px |
| dialog | fontWeight | 400 | 450 |
| dialog | lineHeight | 24px | 21px |
| dialog | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog | backgroundColor | rgba(0, 0, 0, 0) | rgb(27, 31, 28) |
| dialog | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderTopLeftRadius | 20px | 18px |
| dialog | borderTopRightRadius | 20px | 18px |
| dialog | borderBottomRightRadius | 20px | 18px |
| dialog | borderBottomLeftRadius | 20px | 18px |
| dialog | boxShadow | none | rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0, 0.6) 0px 24px 48px -12px, rgba(255, 255 |
| dialog | outlineWidth | 2.4px | 3px |
| dialog | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| dialog | maxWidth | 672px | 343px |
| dialog | transitionProperty | scale | opacity, scale |
| dialog | transitionDuration | 0.12s | 0.1s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | cubic-bezier(0, 0, 0.2, 1) |
| dialog | animationName | none | enter |
| dialog | animationDuration | 0s | 0.1s |
| dialog | animationTimingFunction | ease | cubic-bezier(0, 0, 0.2, 1) |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.5)","color":"rgba(255, 255, 255, 0.93)","radius":" | null |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| listbox | presence | 1 | absent |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 2) | anthropic-sans x26<br>Anthropicons-Variable x19<br>anthropic-serif x1<br>anthropic-sans-display x1 | instrumentSans x46<br>jetbrainsMono x2 |
| fontSize (7 vs 5) | 14px x16<br>20px x15<br>12px x9<br>13px x3<br>16px x2<br>24px x1<br>22px x1 | 14px x30<br>13px x8<br>12px x7<br>15px x2<br>17px x1 |
| fontWeight (7 vs 4) | 400 x17<br>433.25 x15<br>435 x9<br>577.75 x3<br>360 x1<br>533.25 x1<br>520 x1 | 450 x34<br>500 x7<br>600 x4<br>700 x3 |
| lineHeight (9 vs 8) | 20px x30<br>16px x5<br>19px x3<br>12px x3<br>17px x2<br>21px x1<br>28.8px x1<br>22px x1<br>28px x1 | 24px x23<br>20px x8<br>18px x6<br>16px x5<br>22.5px x2<br>16.8px x2<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x47 | normal x48 |
| color (3 vs 5) | rgba(255, 255, 255, 0.57) x25<br>rgba(255, 255, 255, 0.93) x21<br>rgb(255, 255, 255) x1 | rgb(230, 232, 226) x28<br>rgb(163, 170, 164) x13<br>rgb(180, 186, 179) x5<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1 |
| backgroundColor (8 vs 12) | rgb(48, 48, 48) x3<br>rgb(25, 25, 25) x2<br>hsl(none 0% 9.80392%) x1<br>rgb(198, 97, 63) x1<br>rgba(0, 0, 0, 0.5) x1<br>rgba(255, 255, 255, 0.1) x1<br>rgba(255, 255, 255, 0.15) x1<br>rgb(11, 11, 11) x1 | rgb(42, 48, 43) x4<br>rgb(34, 39, 35) x3<br>rgb(27, 31, 28) x2<br>rgb(20, 23, 21) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(38, 44, 39) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgb(163, 170, 164) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1<br>rgba(0, 0, 0, 0.5) x1 |
| borderTopLeftRadius (3 vs 6) | 8px x50<br>20px x3<br>14px x1 | 8px x13<br>3.35544e+07px x5<br>4px x3<br>12px x2<br>14px x2<br>18px x1 |
| boxShadow (3 vs 3) | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgba(0, 0, 0, 0.25) 0px 25px 50px -12px x1<br>color(srgb 0 0 0 / 0.06) 0px 2px 8px 0px x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1<br>rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0, 0.6) 0px  x1 |
| borderTopColor (2 vs 3) | hsl(none 0% 100% / 0.2) x1<br>rgba(255, 255, 255, 0.1) x1 | rgba(0, 0, 0, 0) x8<br>rgb(53, 59, 54) x2<br>rgb(107, 114, 108) x1 |
| borderTopWidth (1 vs 1) | 0.8px x2 | 1px x11 |
| paddingTop (7 vs 7) | 8px x14<br>5px x2<br>12px x2<br>16px x1<br>17.6px x1<br>6px x1<br>10px x1 | 8px x4<br>1px x3<br>2px x3<br>14px x1<br>6px x1<br>12px x1<br>4px x1 |
| paddingLeft (8 vs 9) | 12px x11<br>8px x10<br>10px x7<br>24px x3<br>4px x2<br>14px x2<br>23.04px x1<br>1px x1 | 10px x7<br>6px x4<br>2px x3<br>16px x2<br>12px x2<br>4px x2<br>9px x2<br>14px x2<br>56px x1 |
| rowGap (7 vs 6) | 6px x20<br>4px x19<br>8px x19<br>12px x9<br>24px x1<br>28px x1<br>2px x1 | 8px x13<br>6px x7<br>4px x6<br>2px x4<br>10px x4<br>16px x1 |
| columnGap (7 vs 6) | 6px x20<br>4px x19<br>8px x17<br>12px x9<br>24px x1<br>28px x1<br>2px x1 | 8px x12<br>6px x7<br>4px x6<br>10px x5<br>2px x4<br>16px x1 |
| transitionDuration (8 vs 3) | 0.06s x30<br>0.45s x11<br>0.2s x6<br>0.12s x4<br>0.28s x3<br>0.15s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x8<br>0.2s x1<br>0.1s x1 |
| transitionTimingFunction (6 vs 3) | cubic-bezier(0.165, 0.84, 0.44, 1) x23<br>cubic-bezier(0.4, 0, 0.2, 1) x21<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x11<br>ease-out x1<br>ease-out, linear x1<br>ease x1 | cubic-bezier(0.4, 0, 0.2, 1) x8<br>ease x1<br>cubic-bezier(0, 0, 0.2, 1) x1 |
| animationName (2 vs 2) | static-composer-actions-fade-in x3<br>task-grid-fade-in, task-grid-clip-reveal x1 | enter x2<br>live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x17<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## search-palette / type-query

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 225 vs 180

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 32x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x242 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.22) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x176 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| dialog | count, size | 1, 343.2x196.8 | 1, 343x246 |
| dialog | display | block | flex |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontSize | 16px | 14px |
| dialog | fontWeight | 400 | 450 |
| dialog | lineHeight | 24px | 21px |
| dialog | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog | backgroundColor | rgba(0, 0, 0, 0) | rgb(27, 31, 28) |
| dialog | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderTopLeftRadius | 20px | 18px |
| dialog | borderTopRightRadius | 20px | 18px |
| dialog | borderBottomRightRadius | 20px | 18px |
| dialog | borderBottomLeftRadius | 20px | 18px |
| dialog | boxShadow | none | rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0, 0.6) 0px 24px 48px -12px, rgba(255, 255 |
| dialog | outlineWidth | 2.4px | 3px |
| dialog | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| dialog | maxWidth | 672px | 343px |
| dialog | transitionProperty | scale | opacity, scale |
| dialog | transitionDuration | 0.12s | 0.1s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | cubic-bezier(0, 0, 0.2, 1) |
| dialog | animationName | none | enter |
| dialog | animationDuration | 0s | 0.1s |
| dialog | animationTimingFunction | ease | cubic-bezier(0, 0, 0.2, 1) |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.5)","color":"rgba(255, 255, 255, 0.93)","radius":" | null |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| listbox | presence | 1 | absent |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 2) | anthropic-sans x19<br>Anthropicons-Variable x12<br>anthropic-serif x1<br>anthropic-sans-display x1 | instrumentSans x50<br>jetbrainsMono x2 |
| fontSize (7 vs 5) | 14px x11<br>20px x8<br>12px x5<br>16px x4<br>13px x3<br>24px x1<br>22px x1 | 14px x29<br>13px x12<br>12px x8<br>15px x2<br>17px x1 |
| fontWeight (7 vs 4) | 435 x9<br>433.25 x8<br>400 x8<br>577.75 x3<br>520 x3<br>360 x1<br>533.25 x1 | 450 x37<br>500 x8<br>600 x4<br>700 x3 |
| lineHeight (9 vs 8) | 20px x18<br>16px x3<br>19px x3<br>12px x3<br>22px x2<br>21px x1<br>28.8px x1<br>28px x1<br>24px x1 | 24px x23<br>18px x10<br>20px x7<br>16px x6<br>22.5px x2<br>16.8px x2<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x33 | normal x52 |
| color (3 vs 5) | rgba(255, 255, 255, 0.93) x25<br>rgba(255, 255, 255, 0.57) x7<br>rgb(255, 255, 255) x1 | rgb(230, 232, 226) x27<br>rgb(163, 170, 164) x18<br>rgb(180, 186, 179) x5<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1 |
| backgroundColor (8 vs 12) | rgb(48, 48, 48) x3<br>rgb(25, 25, 25) x2<br>hsl(none 0% 9.80392%) x1<br>rgb(198, 97, 63) x1<br>rgba(0, 0, 0, 0.5) x1<br>rgba(255, 255, 255, 0.1) x1<br>rgba(255, 255, 255, 0.15) x1<br>rgb(11, 11, 11) x1 | rgb(42, 48, 43) x4<br>rgb(34, 39, 35) x3<br>rgb(27, 31, 28) x2<br>rgb(20, 23, 21) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(38, 44, 39) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgb(163, 170, 164) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1<br>rgba(0, 0, 0, 0.5) x1 |
| borderTopLeftRadius (3 vs 6) | 8px x43<br>20px x3<br>14px x1 | 8px x12<br>3.35544e+07px x5<br>4px x3<br>12px x2<br>14px x2<br>18px x1 |
| boxShadow (3 vs 3) | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgba(0, 0, 0, 0.25) 0px 25px 50px -12px x1<br>color(srgb 0 0 0 / 0.06) 0px 2px 8px 0px x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1<br>rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0, 0.6) 0px  x1 |
| borderTopColor (2 vs 3) | hsl(none 0% 100% / 0.2) x1<br>rgba(255, 255, 255, 0.1) x1 | rgba(0, 0, 0, 0) x8<br>rgb(53, 59, 54) x2<br>rgb(107, 114, 108) x1 |
| borderTopWidth (1 vs 1) | 0.8px x2 | 1px x11 |
| paddingTop (6 vs 7) | 8px x7<br>5px x2<br>16px x1<br>17.6px x1<br>6px x1<br>10px x1 | 8px x5<br>1px x3<br>2px x3<br>14px x1<br>6px x1<br>12px x1<br>4px x1 |
| paddingLeft (7 vs 9) | 8px x10<br>10px x7<br>12px x4<br>24px x3<br>4px x2<br>23.04px x1<br>1px x1 | 10px x7<br>12px x4<br>6px x4<br>2px x3<br>16px x2<br>4px x2<br>9px x2<br>14px x2<br>56px x1 |
| rowGap (7 vs 6) | 6px x20<br>4px x19<br>8px x10<br>12px x2<br>24px x1<br>28px x1<br>2px x1 | 8px x13<br>6px x9<br>4px x6<br>2px x4<br>10px x3<br>16px x1 |
| columnGap (7 vs 6) | 6px x20<br>4px x19<br>8px x8<br>12px x2<br>24px x1<br>28px x1<br>2px x1 | 8px x12<br>6px x9<br>4px x6<br>2px x4<br>10px x4<br>16px x1 |
| transitionDuration (8 vs 3) | 0.06s x30<br>0.45s x11<br>0.2s x6<br>0.12s x4<br>0.28s x3<br>0.15s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x7<br>0.2s x1<br>0.1s x1 |
| transitionTimingFunction (6 vs 3) | cubic-bezier(0.165, 0.84, 0.44, 1) x23<br>cubic-bezier(0.4, 0, 0.2, 1) x21<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x11<br>ease-out x1<br>ease-out, linear x1<br>ease x1 | cubic-bezier(0.4, 0, 0.2, 1) x7<br>ease x1<br>cubic-bezier(0, 0, 0.2, 1) x1 |
| animationName (2 vs 2) | static-composer-actions-fade-in x3<br>task-grid-fade-in, task-grid-clip-reveal x1 | enter x2<br>live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x16<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## focus / initial

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 170 vs 136

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 32x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x242 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.36) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x176 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgb(156, 199, 139) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | Anthropicons-Variable x9<br>anthropic-sans x5<br>anthropic-serif x1 | instrumentSans x37<br>jetbrainsMono x2 |
| fontSize (6 vs 5) | 20px x5<br>13px x3<br>12px x3<br>16px x2<br>14px x1<br>24px x1 | 14px x26<br>13px x8<br>15px x2<br>12px x2<br>17px x1 |
| fontWeight (6 vs 4) | 433.25 x5<br>435 x3<br>577.75 x3<br>400 x2<br>360 x1<br>533.25 x1 | 450 x27<br>500 x5<br>600 x4<br>700 x3 |
| lineHeight (7 vs 7) | 20px x5<br>19px x3<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>16px x1 | 24px x23<br>18px x6<br>20px x4<br>22.5px x2<br>16.8px x2<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x15 | normal x39 |
| color (3 vs 5) | rgba(255, 255, 255, 0.93) x11<br>rgba(255, 255, 255, 0.57) x3<br>rgb(255, 255, 255) x1 | rgb(230, 232, 226) x24<br>rgb(163, 170, 164) x8<br>rgb(180, 186, 179) x5<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1 |
| backgroundColor (4 vs 11) | rgb(25, 25, 25) x2<br>hsl(none 0% 9.80392%) x1<br>rgb(48, 48, 48) x1<br>rgb(198, 97, 63) x1 | rgb(42, 48, 43) x4<br>rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(38, 44, 39) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgb(163, 170, 164) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1 |
| borderTopLeftRadius (2 vs 5) | 8px x38<br>14px x1 | 8px x8<br>3.35544e+07px x5<br>4px x3<br>12px x2<br>14px x2 |
| boxShadow (1 vs 2) | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (0 vs 3) |  | rgba(0, 0, 0, 0) x7<br>rgb(53, 59, 54) x1<br>rgb(107, 114, 108) x1 |
| borderTopWidth (0 vs 1) |  | 1px x9 |
| paddingTop (3 vs 6) | 8px x4<br>5px x2<br>16px x1 | 1px x3<br>2px x3<br>8px x2<br>14px x1<br>6px x1<br>12px x1 |
| paddingLeft (5 vs 9) | 8px x10<br>4px x2<br>12px x2<br>23.04px x1<br>1px x1 | 2px x3<br>10px x2<br>12px x2<br>4px x2<br>6px x2<br>9px x2<br>56px x1<br>16px x1<br>14px x1 |
| rowGap (6 vs 4) | 4px x17<br>6px x13<br>8px x7<br>24px x1<br>28px x1<br>2px x1 | 8px x13<br>4px x5<br>2px x4<br>6px x3 |
| columnGap (6 vs 5) | 4px x17<br>6px x13<br>8px x5<br>24px x1<br>28px x1<br>2px x1 | 8px x12<br>4px x5<br>2px x4<br>6px x3<br>10px x1 |
| transitionDuration (7 vs 1) | 0.06s x28<br>0.45s x10<br>0.2s x4<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x2 |
| transitionTimingFunction (5 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x20<br>cubic-bezier(0.165, 0.84, 0.44, 1) x17<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x10<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (2 vs 1) | static-composer-actions-fade-in x3<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x11<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## focus / tab-1

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 177 vs 139

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 32x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x242 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.36) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x176 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |
| tooltip | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | Anthropicons-Variable x9<br>anthropic-sans x9<br>anthropic-serif x1 | instrumentSans x38<br>jetbrainsMono x2 |
| fontSize (6 vs 5) | 12px x6<br>20px x5<br>13px x4<br>16px x2<br>14px x1<br>24px x1 | 14px x26<br>13px x8<br>12px x3<br>15px x2<br>17px x1 |
| fontWeight (6 vs 4) | 400 x6<br>433.25 x5<br>435 x3<br>577.75 x3<br>360 x1<br>533.25 x1 | 450 x28<br>500 x5<br>600 x4<br>700 x3 |
| lineHeight (8 vs 8) | 20px x5<br>18px x4<br>19px x3<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>16px x1 | 24px x23<br>18px x6<br>20px x4<br>22.5px x2<br>16.8px x2<br>12px x1<br>21px x1<br>16px x1 |
| letterSpacing (1 vs 1) | normal x19 | normal x40 |
| color (3 vs 6) | rgba(255, 255, 255, 0.93) x12<br>rgba(255, 255, 255, 0.57) x6<br>rgb(255, 255, 255) x1 | rgb(230, 232, 226) x24<br>rgb(163, 170, 164) x8<br>rgb(180, 186, 179) x5<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1<br>rgb(27, 31, 28) x1 |
| backgroundColor (4 vs 11) | rgb(25, 25, 25) x2<br>rgb(48, 48, 48) x2<br>hsl(none 0% 9.80392%) x1<br>rgb(198, 97, 63) x1 | rgb(42, 48, 43) x4<br>rgb(34, 39, 35) x3<br>rgb(230, 232, 226) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(38, 44, 39) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgb(163, 170, 164) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1 |
| borderTopLeftRadius (3 vs 6) | 8px x38<br>14px x1<br>6px x1 | 8px x9<br>3.35544e+07px x5<br>4px x3<br>12px x2<br>14px x2<br>2px x1 |
| boxShadow (4 vs 2) | rgb(25, 25, 25) 0px 0px 0px 1px inset, rgb(37, 125, 224) 0px x1<br>rgb(25, 25, 25) 0px 0px 0px 1px inset x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (0 vs 3) |  | rgba(0, 0, 0, 0) x7<br>rgb(53, 59, 54) x1<br>rgb(107, 114, 108) x1 |
| borderTopWidth (0 vs 1) |  | 1px x9 |
| paddingTop (4 vs 6) | 8px x4<br>5px x2<br>16px x1<br>3px x1 | 1px x3<br>2px x3<br>8px x2<br>6px x2<br>14px x1<br>12px x1 |
| paddingLeft (5 vs 9) | 8px x11<br>4px x2<br>12px x2<br>23.04px x1<br>1px x1 | 12px x3<br>2px x3<br>10px x2<br>4px x2<br>6px x2<br>9px x2<br>56px x1<br>16px x1<br>14px x1 |
| rowGap (7 vs 4) | 4px x17<br>6px x13<br>8px x8<br>24px x1<br>28px x1<br>2px x1<br>1.8px x1 | 8px x13<br>4px x5<br>2px x4<br>6px x4 |
| columnGap (7 vs 5) | 4px x17<br>6px x13<br>8px x6<br>24px x1<br>28px x1<br>2px x1<br>1.8px x1 | 8px x12<br>4px x5<br>2px x4<br>6px x4<br>10px x1 |
| transitionDuration (7 vs 1) | 0.06s x27<br>0.45s x10<br>0.2s x5<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x2 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x19<br>cubic-bezier(0.165, 0.84, 0.44, 1) x17<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x10<br>ease x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (2 vs 2) | static-composer-actions-fade-in x3<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1<br>enter x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x11<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## focus / tab-2

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 179 vs 136

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 32x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | boxShadow | rgb(25, 25, 25) 0px 0px 0px 1px inset, rgb(37, 125, 224) 0px 0px 0px 1px, color(srgb 0.090 | none |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(0, 0, 0, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | outline | all |
| button.primary | transitionDuration | 0.2s | 0s |
| button.primary | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x242 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.36) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x176 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 2px |
| composer.model | outlineStyle | none | solid |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(156, 199, 139) |
| composer.model | outlineOffset | 1.6px | 2px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |
| tooltip | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | anthropic-sans x11<br>Anthropicons-Variable x9<br>anthropic-serif x1 | instrumentSans x37<br>jetbrainsMono x2 |
| fontSize (6 vs 5) | 12px x8<br>20px x5<br>13px x4<br>16px x2<br>14px x1<br>24px x1 | 14px x26<br>13px x8<br>15px x2<br>12px x2<br>17px x1 |
| fontWeight (6 vs 4) | 400 x8<br>433.25 x5<br>435 x3<br>577.75 x3<br>360 x1<br>533.25 x1 | 450 x27<br>500 x5<br>600 x4<br>700 x3 |
| lineHeight (8 vs 7) | 18px x6<br>20px x5<br>19px x3<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>16px x1 | 24px x23<br>18px x6<br>20px x4<br>22.5px x2<br>16.8px x2<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x21 | normal x39 |
| color (3 vs 5) | rgba(255, 255, 255, 0.93) x12<br>rgba(255, 255, 255, 0.57) x8<br>rgb(255, 255, 255) x1 | rgb(230, 232, 226) x24<br>rgb(163, 170, 164) x8<br>rgb(180, 186, 179) x5<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1 |
| backgroundColor (4 vs 11) | rgb(25, 25, 25) x2<br>rgb(48, 48, 48) x2<br>hsl(none 0% 9.80392%) x1<br>rgb(198, 97, 63) x1 | rgb(42, 48, 43) x4<br>rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(38, 44, 39) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgb(163, 170, 164) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1 |
| borderTopLeftRadius (3 vs 5) | 8px x38<br>14px x1<br>6px x1 | 8px x8<br>3.35544e+07px x5<br>4px x3<br>12px x2<br>14px x2 |
| boxShadow (4 vs 2) | rgb(25, 25, 25) 0px 0px 0px 1px inset, rgb(37, 125, 224) 0px x1<br>rgb(25, 25, 25) 0px 0px 0px 1px inset x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (0 vs 3) |  | rgba(0, 0, 0, 0) x7<br>rgb(53, 59, 54) x1<br>rgb(107, 114, 108) x1 |
| borderTopWidth (0 vs 1) |  | 1px x9 |
| paddingTop (4 vs 6) | 8px x4<br>5px x2<br>16px x1<br>3px x1 | 1px x3<br>2px x3<br>8px x2<br>14px x1<br>6px x1<br>12px x1 |
| paddingLeft (5 vs 9) | 8px x11<br>4px x2<br>12px x2<br>23.04px x1<br>1px x1 | 2px x3<br>10px x2<br>12px x2<br>4px x2<br>6px x2<br>9px x2<br>56px x1<br>16px x1<br>14px x1 |
| rowGap (7 vs 4) | 4px x17<br>6px x13<br>8px x8<br>24px x1<br>28px x1<br>2px x1<br>1.8px x1 | 8px x13<br>4px x5<br>2px x4<br>6px x3 |
| columnGap (7 vs 5) | 4px x17<br>6px x13<br>8px x6<br>24px x1<br>28px x1<br>2px x1<br>1.8px x1 | 8px x12<br>4px x5<br>2px x4<br>6px x3<br>10px x1 |
| transitionDuration (7 vs 1) | 0.06s x27<br>0.45s x10<br>0.2s x5<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x2 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x19<br>cubic-bezier(0.165, 0.84, 0.44, 1) x17<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x10<br>ease-out x1<br>ease x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (2 vs 1) | static-composer-actions-fade-in x3<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x11<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## focus / tab-3

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 170 vs 136

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 32x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x242 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.36) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x176 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | Anthropicons-Variable x9<br>anthropic-sans x5<br>anthropic-serif x1 | instrumentSans x37<br>jetbrainsMono x2 |
| fontSize (6 vs 5) | 20px x5<br>13px x3<br>12px x3<br>16px x2<br>14px x1<br>24px x1 | 14px x26<br>13px x8<br>15px x2<br>12px x2<br>17px x1 |
| fontWeight (6 vs 4) | 433.25 x5<br>435 x3<br>577.75 x3<br>400 x2<br>360 x1<br>533.25 x1 | 450 x27<br>500 x5<br>600 x4<br>700 x3 |
| lineHeight (7 vs 7) | 20px x5<br>19px x3<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>16px x1 | 24px x23<br>18px x6<br>20px x4<br>22.5px x2<br>16.8px x2<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x15 | normal x39 |
| color (3 vs 5) | rgba(255, 255, 255, 0.93) x11<br>rgba(255, 255, 255, 0.57) x3<br>rgb(255, 255, 255) x1 | rgb(230, 232, 226) x24<br>rgb(163, 170, 164) x8<br>rgb(180, 186, 179) x5<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1 |
| backgroundColor (4 vs 11) | rgb(25, 25, 25) x2<br>hsl(none 0% 9.80392%) x1<br>rgb(48, 48, 48) x1<br>rgb(198, 97, 63) x1 | rgb(42, 48, 43) x4<br>rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(38, 44, 39) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgb(163, 170, 164) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1 |
| borderTopLeftRadius (2 vs 5) | 8px x38<br>14px x1 | 8px x8<br>3.35544e+07px x5<br>4px x3<br>12px x2<br>14px x2 |
| boxShadow (1 vs 2) | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(255, 255, 2 x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (0 vs 3) |  | rgba(0, 0, 0, 0) x7<br>rgb(53, 59, 54) x1<br>rgb(107, 114, 108) x1 |
| borderTopWidth (0 vs 1) |  | 1px x9 |
| paddingTop (3 vs 6) | 8px x4<br>5px x2<br>16px x1 | 1px x3<br>2px x3<br>8px x2<br>14px x1<br>6px x1<br>12px x1 |
| paddingLeft (5 vs 9) | 8px x10<br>4px x2<br>12px x2<br>23.04px x1<br>1px x1 | 2px x3<br>10px x2<br>12px x2<br>4px x2<br>6px x2<br>9px x2<br>56px x1<br>16px x1<br>14px x1 |
| rowGap (6 vs 4) | 4px x17<br>6px x13<br>8px x7<br>24px x1<br>28px x1<br>2px x1 | 8px x13<br>4px x5<br>2px x4<br>6px x3 |
| columnGap (6 vs 5) | 4px x17<br>6px x13<br>8px x5<br>24px x1<br>28px x1<br>2px x1 | 8px x12<br>4px x5<br>2px x4<br>6px x3<br>10px x1 |
| transitionDuration (7 vs 1) | 0.06s x28<br>0.45s x10<br>0.2s x4<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x2 |
| transitionTimingFunction (5 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x20<br>cubic-bezier(0.165, 0.84, 0.44, 1) x17<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x10<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (2 vs 1) | static-composer-actions-fade-in x3<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x11<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## focus / tab-4

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 175 vs 136

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 32x32 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 9px |
| button.primary | paddingLeft | 0px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | pointer | default |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 343.2x242 | 1, 343x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.22) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | boxShadow | rgb(48, 48, 48) 0px 0px 0px 1px inset, rgb(37, 125, 224) 0px 0px 0px 1px, color(srgb 0.090 | none |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(0, 0, 0, 0) | rgb(22, 26, 23) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | outline | all |
| composer.button | transitionDuration | 0.2s | 0s |
| composer.button | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 319.2x176 | 1, 315x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 136.3x32 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 12px | 0px |
| composer.model | paddingLeft | 12px | 0px |
| composer.model | marginTop | -4px | 0px |
| composer.model | marginBottom | -4px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 375.2x48 | 1, 375x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |
| tooltip | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | Anthropicons-Variable x9<br>anthropic-sans x7<br>anthropic-serif x1 | instrumentSans x37<br>jetbrainsMono x2 |
| fontSize (6 vs 5) | 20px x5<br>13px x4<br>12px x4<br>16px x2<br>14px x1<br>24px x1 | 14px x26<br>13px x8<br>15px x2<br>12px x2<br>17px x1 |
| fontWeight (6 vs 4) | 433.25 x5<br>400 x4<br>435 x3<br>577.75 x3<br>360 x1<br>533.25 x1 | 450 x27<br>500 x5<br>600 x4<br>700 x3 |
| lineHeight (8 vs 7) | 20px x5<br>19px x3<br>12px x3<br>18px x2<br>21px x1<br>28.8px x1<br>22px x1<br>16px x1 | 24px x23<br>18px x6<br>20px x4<br>22.5px x2<br>16.8px x2<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x17 | normal x39 |
| color (3 vs 5) | rgba(255, 255, 255, 0.93) x12<br>rgba(255, 255, 255, 0.57) x4<br>rgb(255, 255, 255) x1 | rgb(230, 232, 226) x24<br>rgb(163, 170, 164) x8<br>rgb(180, 186, 179) x5<br>rgb(242, 207, 134) x1<br>rgb(22, 26, 23) x1 |
| backgroundColor (4 vs 11) | rgb(25, 25, 25) x2<br>rgb(48, 48, 48) x2<br>hsl(none 0% 9.80392%) x1<br>rgb(198, 97, 63) x1 | rgb(42, 48, 43) x4<br>rgb(34, 39, 35) x3<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>rgb(38, 44, 39) x1<br>color(srgb 0.243686 0.230902 0.161961) x1<br>rgb(163, 170, 164) x1<br>rgb(230, 232, 226) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1 |
| borderTopLeftRadius (3 vs 5) | 8px x38<br>14px x1<br>6px x1 | 8px x8<br>3.35544e+07px x5<br>4px x3<br>12px x2<br>14px x2 |
| boxShadow (4 vs 2) | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgb(48, 48, 48) 0px 0px 0px 1px inset, rgb(37, 125, 224) 0px x1<br>rgb(48, 48, 48) 0px 0px 0px 1px inset x1<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% x1 | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (0 vs 3) |  | rgba(0, 0, 0, 0) x7<br>rgb(53, 59, 54) x1<br>rgb(107, 114, 108) x1 |
| borderTopWidth (0 vs 1) |  | 1px x9 |
| paddingTop (4 vs 6) | 8px x4<br>5px x2<br>16px x1<br>3px x1 | 1px x3<br>2px x3<br>8px x2<br>14px x1<br>6px x1<br>12px x1 |
| paddingLeft (5 vs 9) | 8px x11<br>4px x2<br>12px x2<br>23.04px x1<br>1px x1 | 2px x3<br>10px x2<br>12px x2<br>4px x2<br>6px x2<br>9px x2<br>56px x1<br>16px x1<br>14px x1 |
| rowGap (7 vs 4) | 4px x17<br>6px x13<br>8px x8<br>24px x1<br>28px x1<br>2px x1<br>1.8px x1 | 8px x13<br>4px x5<br>2px x4<br>6px x3 |
| columnGap (7 vs 5) | 4px x17<br>6px x13<br>8px x6<br>24px x1<br>28px x1<br>2px x1<br>1.8px x1 | 8px x12<br>4px x5<br>2px x4<br>6px x3<br>10px x1 |
| transitionDuration (7 vs 1) | 0.06s x27<br>0.45s x10<br>0.2s x5<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x2 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x19<br>cubic-bezier(0.165, 0.84, 0.44, 1) x17<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x10<br>ease-out x1<br>ease x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (2 vs 1) | static-composer-actions-fade-in x3<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x11<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## settings / initial

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 352 vs 134

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 14, 32x32 | 1, 30.8x12.8 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| composer.box | count, size | 1, 343.2x88 | 1, 130.8x34.4 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.22) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 10px |
| composer.box | marginRight | 0px | 16px |
| composer.box | marginBottom | 0px | 10px |
| composer.box | marginLeft | 0px | 16px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 2, 11.2x11.2 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | rowGap | 6px | normal |
| composer.button | columnGap | 6px | normal |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.input | count, size | 1, 319.2x22 | 1, 119.6x14.4 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | presence | 1 | absent |
| dialog | count, size | 1, 343.2x780 | 3, 375x812 |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 400 | 450 |
| dialog | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog | backgroundColor | rgb(48, 48, 48) | rgb(27, 31, 28) |
| dialog | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderTopLeftRadius | 12px | 0px |
| dialog | borderTopRightRadius | 12px | 0px |
| dialog | borderBottomRightRadius | 12px | 0px |
| dialog | borderBottomLeftRadius | 12px | 0px |
| dialog | boxShadow | rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% 4.31373% / 0.08) 0px 4px 8px  | none |
| dialog | outlineWidth | 1.6px | 1px |
| dialog | outlineColor | rgba(0, 0, 0, 0) | rgb(238, 238, 238) |
| dialog | outlineOffset | 1.6px | 0px |
| dialog | maxWidth | 720px | none |
| dialog | transitionProperty | opacity, scale, filter | all |
| dialog | transitionDuration | 0.2s | 0s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | ease |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.5)","color":"rgba(255, 255, 255, 0.93)","radius":" | null |
| dialog.input | count, size | 11, 1x1 | 1, 311x32 |
| dialog.input | position | fixed | static |
| dialog.input | fontFamily | anthropic-sans | instrumentSans |
| dialog.input | fontSize | 14px | 16px |
| dialog.input | fontWeight | 400 | 450 |
| dialog.input | lineHeight | 20px | 24px |
| dialog.input | whiteSpace | nowrap | normal |
| dialog.input | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog.input | backgroundColor | rgba(0, 0, 0, 0) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| dialog.input | borderTopWidth | 0px | 1px |
| dialog.input | borderTopStyle | none | solid |
| dialog.input | borderTopColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderRightWidth | 0px | 1px |
| dialog.input | borderRightStyle | none | solid |
| dialog.input | borderRightColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderBottomWidth | 0px | 1px |
| dialog.input | borderBottomStyle | none | solid |
| dialog.input | borderBottomColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderLeftWidth | 0px | 1px |
| dialog.input | borderLeftStyle | none | solid |
| dialog.input | borderLeftColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderTopLeftRadius | 50% | 8px |
| dialog.input | borderTopRightRadius | 50% | 8px |
| dialog.input | borderBottomRightRadius | 50% | 8px |
| dialog.input | borderBottomLeftRadius | 50% | 8px |
| dialog.input | outlineWidth | 1.6px | 3px |
| dialog.input | outlineStyle | solid | none |
| dialog.input | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| dialog.input | outlineOffset | 1.6px | 0px |
| dialog.input | paddingTop | 0px | 4px |
| dialog.input | paddingRight | 0px | 10px |
| dialog.input | paddingBottom | 0px | 4px |
| dialog.input | paddingLeft | 0px | 10px |
| dialog.input | marginTop | -1px | 0px |
| dialog.input | marginRight | -1px | 0px |
| dialog.input | marginBottom | -1px | 0px |
| dialog.input | marginLeft | -1px | 0px |
| dialog.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.input | transitionDuration | 0s | 0.15s |
| dialog.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.input | cursor | default | text |
| dialog.radiogroup | presence | 1 | absent |
| dialog.select | count, size | 7, 191.9x32 | 1, 89.8x32 |
| dialog.select | fontFamily | anthropic-sans | instrumentSans |
| dialog.select | fontWeight | 435 | 450 |
| dialog.select | whiteSpace | normal | nowrap |
| dialog.select | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog.select | backgroundColor | rgba(0, 0, 0, 0) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| dialog.select | borderTopWidth | 0px | 1px |
| dialog.select | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderRightWidth | 0px | 1px |
| dialog.select | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderBottomWidth | 0px | 1px |
| dialog.select | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderLeftWidth | 0px | 1px |
| dialog.select | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderTopLeftRadius | 0px | 8px |
| dialog.select | borderTopRightRadius | 0px | 8px |
| dialog.select | borderBottomRightRadius | 0px | 8px |
| dialog.select | borderBottomLeftRadius | 0px | 8px |
| dialog.select | boxShadow | none | rgba(0, 0, 0, 0.3) 0px 1px 2px 0px |
| dialog.select | outlineWidth | 1.6px | 3px |
| dialog.select | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| dialog.select | outlineOffset | 1.6px | 0px |
| dialog.select | paddingTop | 0px | 8px |
| dialog.select | paddingRight | 0px | 8px |
| dialog.select | paddingBottom | 0px | 8px |
| dialog.select | paddingLeft | 8px | 10px |
| dialog.select | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.select | transitionDuration | 0s | 0.15s |
| dialog.select | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.select | cursor | pointer | default |
| dialog.select | textAlign | start | center |
| dialog.switch | presence | absent | 3 |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| project.card | presence | absent | 3 |
| shell.header | count, size | 1, 375.2x48 | 1, 143.6x16 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingTop | 0px | 4px |
| shell.header | paddingRight | 0px | 16px |
| shell.header | paddingBottom | 0px | 12px |
| shell.header | paddingLeft | 0px | 16px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.main | presence | 1 | absent |
| shell.sidebar | count, size | 1, 32x32 | 1, 143.6x240 |
| shell.sidebar | position | absolute | fixed |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | backgroundColor | rgba(0, 0, 0, 0) | rgb(34, 39, 35) |
| shell.sidebar | opacity | 1 | 0 |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderTopLeftRadius | 0px | 18px |
| shell.sidebar | borderTopRightRadius | 0px | 18px |
| shell.sidebar | borderBottomRightRadius | 0px | 18px |
| shell.sidebar | borderBottomLeftRadius | 0px | 18px |
| shell.sidebar | boxShadow | none | rgb(53, 59, 54) 0px 0px 0px 0.5px inset, rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0 |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.sidebar | maxWidth | none | 359px |
| shell.sidebar | transitionDuration | 0s | 0.2s |
| shell.sidebar | transitionTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| shell.sidebar | animationName | none | exit |
| shell.sidebar | animationDuration | 0s | 0.2s |
| shell.sidebar | animationTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | anthropic-sans x34<br>Anthropicons-Variable x23<br>anthropic-serif x2 | instrumentSans x27<br>sourceSerif4 x1 |
| fontSize (7 vs 6) | 14px x24<br>16px x11<br>20px x10<br>13px x6<br>12px x4<br>15px x3<br>24px x1 | 14px x17<br>13px x6<br>17px x2<br>20px x1<br>16px x1<br>15px x1 |
| fontWeight (7 vs 4) | 435 x17<br>400 x15<br>433.25 x10<br>533.25 x10<br>577.75 x3<br>520 x3<br>360 x1 | 450 x18<br>500 x7<br>650 x2<br>600 x1 |
| lineHeight (8 vs 6) | 20px x36<br>16px x12<br>19px x4<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>17px x1 | 20px x17<br>18px x6<br>24px x2<br>26px x1<br>22px x1<br>22.5px x1 |
| letterSpacing (1 vs 2) | normal x59 | normal x27<br>-0.35px x1 |
| color (4 vs 4) | rgba(255, 255, 255, 0.93) x42<br>rgba(255, 255, 255, 0.57) x13<br>rgba(255, 255, 255, 0.4) x3<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x17<br>rgb(163, 170, 164) x6<br>rgb(180, 186, 179) x4<br>rgb(22, 26, 23) x1 |
| backgroundColor (9 vs 9) | rgb(25, 25, 25) x6<br>rgb(31, 31, 31) x4<br>rgb(48, 48, 48) x3<br>hsl(none 0% 100% / 0.05) x3<br>rgba(251, 179, 21, 0.08) x2<br>hsl(none 0% 9.80392%) x1<br>rgba(255, 255, 255, 0.05) x1<br>rgba(0, 0, 0, 0.5) x1<br>hsl(none 0% 100% / 0.1) x1 | rgb(34, 39, 35) x12<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x3<br>rgb(67, 74, 68) x3<br>rgb(255, 255, 255) x3<br>rgb(20, 23, 21) x1<br>rgba(0, 0, 0, 0.6) x1<br>rgb(27, 31, 28) x1<br>rgb(230, 232, 226) x1<br>rgb(42, 48, 43) x1 |
| borderTopLeftRadius (7 vs 4) | 8px x55<br>6px x12<br>11px x8<br>7px x5<br>50% x3<br>12px x2<br>14px x1 | 14px x11<br>3.35544e+07px x10<br>8px x7<br>18px x1 |
| boxShadow (7 vs 6) | hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 100% / 0.1) 0px 0px 0px 1px x2<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% x1<br>hsl(none 0% 100% / 0.2) 0px 0px 0px 1px x1 | rgb(53, 59, 54) 0px 0px 0px 1px x4<br>rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x3<br>oklab(0.927781 -0.00430253 0.00707078 / 0.08) 0px 0px 0px 1p x1<br>rgba(0, 0, 0, 0.3) 0px 1px 2px 0px x1<br>rgb(53, 59, 54) 0px 0px 0px 0.5px inset, rgba(0, 0, 0, 0.4)  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (2 vs 2) | hsl(none 0% 100% / 0.05) x5<br>hsl(none 0% 100% / 0.2) x4 | rgba(0, 0, 0, 0) x3<br>rgb(107, 114, 108) x3 |
| borderTopWidth (1 vs 1) | 0.8px x9 | 1px x6 |
| paddingTop (7 vs 8) | 8px x9<br>12px x7<br>5px x3<br>16px x2<br>14px x2<br>4px x2<br>1px x1 | 12px x5<br>16px x4<br>6px x4<br>2px x3<br>4px x2<br>8px x1<br>24px x1<br>14px x1 |
| paddingLeft (7 vs 7) | 8px x22<br>12px x9<br>4px x4<br>16px x3<br>1px x2<br>14px x2<br>23.04px x1 | 16px x12<br>2px x6<br>12px x5<br>10px x3<br>4px x1<br>24px x1<br>14px x1 |
| rowGap (9 vs 8) | 6px x39<br>4px x30<br>12px x9<br>8px x7<br>28px x3<br>24px x1<br>2px x1<br>5px x1<br>16px x1 | 12px x10<br>16px x7<br>8px x4<br>6px x4<br>2px x2<br>10px x2<br>24px x1<br>4px x1 |
| columnGap (9 vs 8) | 6px x39<br>4px x30<br>12px x9<br>8px x5<br>28px x3<br>24px x1<br>2px x1<br>5px x1<br>16px x1 | 12px x10<br>16px x7<br>8px x4<br>6px x4<br>2px x2<br>10px x2<br>24px x1<br>4px x1 |
| transitionDuration (8 vs 2) | 0.06s x47<br>0.45s x18<br>0.2s x18<br>0.15s x8<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x11<br>0.2s x1 |
| transitionTimingFunction (5 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x44<br>cubic-bezier(0.165, 0.84, 0.44, 1) x34<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x18<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x11<br>cubic-bezier(0.32, 0.72, 0, 1) x1 |
| animationName (4 vs 1) | static-composer-actions-fade-in x4<br>task-grid-fade-in, task-grid-clip-reveal x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1<br>cds-scroll-fade-left, cds-scroll-fade-right, cds-scroll-fade x1 | exit x1 |
| strokeWidth (2 vs 1) | 1.25px x2<br>1px x1 | 1.75px x12 |

root custom properties: claude.ai 1383, cairn 72

## settings / settle-dialog

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 352 vs 134

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 14, 32x32 | 1, 30.8x12.8 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| composer.box | count, size | 1, 343.2x88 | 1, 130.8x34.4 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.22) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 10px |
| composer.box | marginRight | 0px | 16px |
| composer.box | marginBottom | 0px | 10px |
| composer.box | marginLeft | 0px | 16px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 2, 11.2x11.2 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | rowGap | 6px | normal |
| composer.button | columnGap | 6px | normal |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.input | count, size | 1, 319.2x22 | 1, 119.6x14.4 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | presence | 1 | absent |
| dialog | count, size | 1, 343.2x780 | 3, 375x812 |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 400 | 450 |
| dialog | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog | backgroundColor | rgb(48, 48, 48) | rgb(27, 31, 28) |
| dialog | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderTopLeftRadius | 12px | 0px |
| dialog | borderTopRightRadius | 12px | 0px |
| dialog | borderBottomRightRadius | 12px | 0px |
| dialog | borderBottomLeftRadius | 12px | 0px |
| dialog | boxShadow | rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% 4.31373% / 0.08) 0px 4px 8px  | none |
| dialog | outlineWidth | 1.6px | 1px |
| dialog | outlineColor | rgba(0, 0, 0, 0) | rgb(238, 238, 238) |
| dialog | outlineOffset | 1.6px | 0px |
| dialog | maxWidth | 720px | none |
| dialog | transitionProperty | opacity, scale, filter | all |
| dialog | transitionDuration | 0.2s | 0s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | ease |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.5)","color":"rgba(255, 255, 255, 0.93)","radius":" | null |
| dialog.input | count, size | 11, 1x1 | 1, 311x32 |
| dialog.input | position | fixed | static |
| dialog.input | fontFamily | anthropic-sans | instrumentSans |
| dialog.input | fontSize | 14px | 16px |
| dialog.input | fontWeight | 400 | 450 |
| dialog.input | lineHeight | 20px | 24px |
| dialog.input | whiteSpace | nowrap | normal |
| dialog.input | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog.input | backgroundColor | rgba(0, 0, 0, 0) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| dialog.input | borderTopWidth | 0px | 1px |
| dialog.input | borderTopStyle | none | solid |
| dialog.input | borderTopColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderRightWidth | 0px | 1px |
| dialog.input | borderRightStyle | none | solid |
| dialog.input | borderRightColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderBottomWidth | 0px | 1px |
| dialog.input | borderBottomStyle | none | solid |
| dialog.input | borderBottomColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderLeftWidth | 0px | 1px |
| dialog.input | borderLeftStyle | none | solid |
| dialog.input | borderLeftColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderTopLeftRadius | 50% | 8px |
| dialog.input | borderTopRightRadius | 50% | 8px |
| dialog.input | borderBottomRightRadius | 50% | 8px |
| dialog.input | borderBottomLeftRadius | 50% | 8px |
| dialog.input | outlineWidth | 1.6px | 3px |
| dialog.input | outlineStyle | solid | none |
| dialog.input | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| dialog.input | outlineOffset | 1.6px | 0px |
| dialog.input | paddingTop | 0px | 4px |
| dialog.input | paddingRight | 0px | 10px |
| dialog.input | paddingBottom | 0px | 4px |
| dialog.input | paddingLeft | 0px | 10px |
| dialog.input | marginTop | -1px | 0px |
| dialog.input | marginRight | -1px | 0px |
| dialog.input | marginBottom | -1px | 0px |
| dialog.input | marginLeft | -1px | 0px |
| dialog.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.input | transitionDuration | 0s | 0.15s |
| dialog.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.input | cursor | default | text |
| dialog.radiogroup | presence | 1 | absent |
| dialog.select | count, size | 7, 191.9x32 | 1, 89.8x32 |
| dialog.select | fontFamily | anthropic-sans | instrumentSans |
| dialog.select | fontWeight | 435 | 450 |
| dialog.select | whiteSpace | normal | nowrap |
| dialog.select | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog.select | backgroundColor | rgba(0, 0, 0, 0) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| dialog.select | borderTopWidth | 0px | 1px |
| dialog.select | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderRightWidth | 0px | 1px |
| dialog.select | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderBottomWidth | 0px | 1px |
| dialog.select | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderLeftWidth | 0px | 1px |
| dialog.select | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderTopLeftRadius | 0px | 8px |
| dialog.select | borderTopRightRadius | 0px | 8px |
| dialog.select | borderBottomRightRadius | 0px | 8px |
| dialog.select | borderBottomLeftRadius | 0px | 8px |
| dialog.select | boxShadow | none | rgba(0, 0, 0, 0.3) 0px 1px 2px 0px |
| dialog.select | outlineWidth | 1.6px | 3px |
| dialog.select | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| dialog.select | outlineOffset | 1.6px | 0px |
| dialog.select | paddingTop | 0px | 8px |
| dialog.select | paddingRight | 0px | 8px |
| dialog.select | paddingBottom | 0px | 8px |
| dialog.select | paddingLeft | 8px | 10px |
| dialog.select | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.select | transitionDuration | 0s | 0.15s |
| dialog.select | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.select | cursor | pointer | default |
| dialog.select | textAlign | start | center |
| dialog.switch | presence | absent | 3 |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| project.card | presence | absent | 3 |
| shell.header | count, size | 1, 375.2x48 | 1, 143.6x16 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingTop | 0px | 4px |
| shell.header | paddingRight | 0px | 16px |
| shell.header | paddingBottom | 0px | 12px |
| shell.header | paddingLeft | 0px | 16px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.main | presence | 1 | absent |
| shell.sidebar | count, size | 1, 32x32 | 1, 143.6x240 |
| shell.sidebar | position | absolute | fixed |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | backgroundColor | rgba(0, 0, 0, 0) | rgb(34, 39, 35) |
| shell.sidebar | opacity | 1 | 0 |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderTopLeftRadius | 0px | 18px |
| shell.sidebar | borderTopRightRadius | 0px | 18px |
| shell.sidebar | borderBottomRightRadius | 0px | 18px |
| shell.sidebar | borderBottomLeftRadius | 0px | 18px |
| shell.sidebar | boxShadow | none | rgb(53, 59, 54) 0px 0px 0px 0.5px inset, rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0 |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.sidebar | maxWidth | none | 359px |
| shell.sidebar | transitionDuration | 0s | 0.2s |
| shell.sidebar | transitionTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| shell.sidebar | animationName | none | exit |
| shell.sidebar | animationDuration | 0s | 0.2s |
| shell.sidebar | animationTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | anthropic-sans x34<br>Anthropicons-Variable x23<br>anthropic-serif x2 | instrumentSans x27<br>sourceSerif4 x1 |
| fontSize (7 vs 6) | 14px x24<br>16px x11<br>20px x10<br>13px x6<br>12px x4<br>15px x3<br>24px x1 | 14px x17<br>13px x6<br>17px x2<br>20px x1<br>16px x1<br>15px x1 |
| fontWeight (7 vs 4) | 435 x17<br>400 x15<br>433.25 x10<br>533.25 x10<br>577.75 x3<br>520 x3<br>360 x1 | 450 x18<br>500 x7<br>650 x2<br>600 x1 |
| lineHeight (8 vs 6) | 20px x36<br>16px x12<br>19px x4<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>17px x1 | 20px x17<br>18px x6<br>24px x2<br>26px x1<br>22px x1<br>22.5px x1 |
| letterSpacing (1 vs 2) | normal x59 | normal x27<br>-0.35px x1 |
| color (4 vs 4) | rgba(255, 255, 255, 0.93) x42<br>rgba(255, 255, 255, 0.57) x13<br>rgba(255, 255, 255, 0.4) x3<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x17<br>rgb(163, 170, 164) x6<br>rgb(180, 186, 179) x4<br>rgb(22, 26, 23) x1 |
| backgroundColor (9 vs 9) | rgb(25, 25, 25) x6<br>rgb(31, 31, 31) x4<br>rgb(48, 48, 48) x3<br>hsl(none 0% 100% / 0.05) x3<br>rgba(251, 179, 21, 0.08) x2<br>hsl(none 0% 9.80392%) x1<br>rgba(255, 255, 255, 0.05) x1<br>rgba(0, 0, 0, 0.5) x1<br>hsl(none 0% 100% / 0.1) x1 | rgb(34, 39, 35) x12<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x3<br>rgb(67, 74, 68) x3<br>rgb(255, 255, 255) x3<br>rgb(20, 23, 21) x1<br>rgba(0, 0, 0, 0.6) x1<br>rgb(27, 31, 28) x1<br>rgb(230, 232, 226) x1<br>rgb(42, 48, 43) x1 |
| borderTopLeftRadius (7 vs 4) | 8px x55<br>6px x12<br>11px x8<br>7px x5<br>50% x3<br>12px x2<br>14px x1 | 14px x11<br>3.35544e+07px x10<br>8px x7<br>18px x1 |
| boxShadow (7 vs 6) | hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 100% / 0.1) 0px 0px 0px 1px x2<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% x1<br>hsl(none 0% 100% / 0.2) 0px 0px 0px 1px x1 | rgb(53, 59, 54) 0px 0px 0px 1px x4<br>rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x3<br>oklab(0.927781 -0.00430253 0.00707078 / 0.08) 0px 0px 0px 1p x1<br>rgba(0, 0, 0, 0.3) 0px 1px 2px 0px x1<br>rgb(53, 59, 54) 0px 0px 0px 0.5px inset, rgba(0, 0, 0, 0.4)  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (2 vs 2) | hsl(none 0% 100% / 0.05) x5<br>hsl(none 0% 100% / 0.2) x4 | rgba(0, 0, 0, 0) x3<br>rgb(107, 114, 108) x3 |
| borderTopWidth (1 vs 1) | 0.8px x9 | 1px x6 |
| paddingTop (7 vs 8) | 8px x9<br>12px x7<br>5px x3<br>16px x2<br>14px x2<br>4px x2<br>1px x1 | 12px x5<br>16px x4<br>6px x4<br>2px x3<br>4px x2<br>8px x1<br>24px x1<br>14px x1 |
| paddingLeft (7 vs 7) | 8px x22<br>12px x9<br>4px x4<br>16px x3<br>1px x2<br>14px x2<br>23.04px x1 | 16px x12<br>2px x6<br>12px x5<br>10px x3<br>4px x1<br>24px x1<br>14px x1 |
| rowGap (9 vs 8) | 6px x39<br>4px x30<br>12px x9<br>8px x7<br>28px x3<br>24px x1<br>2px x1<br>5px x1<br>16px x1 | 12px x10<br>16px x7<br>8px x4<br>6px x4<br>2px x2<br>10px x2<br>24px x1<br>4px x1 |
| columnGap (9 vs 8) | 6px x39<br>4px x30<br>12px x9<br>8px x5<br>28px x3<br>24px x1<br>2px x1<br>5px x1<br>16px x1 | 12px x10<br>16px x7<br>8px x4<br>6px x4<br>2px x2<br>10px x2<br>24px x1<br>4px x1 |
| transitionDuration (8 vs 2) | 0.06s x47<br>0.45s x18<br>0.2s x18<br>0.15s x8<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x11<br>0.2s x1 |
| transitionTimingFunction (5 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x44<br>cubic-bezier(0.165, 0.84, 0.44, 1) x34<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x18<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x11<br>cubic-bezier(0.32, 0.72, 0, 1) x1 |
| animationName (4 vs 1) | static-composer-actions-fade-in x4<br>task-grid-fade-in, task-grid-clip-reveal x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1<br>cds-scroll-fade-left, cds-scroll-fade-right, cds-scroll-fade x1 | exit x1 |
| strokeWidth (2 vs 1) | 1.25px x2<br>1px x1 | 1.75px x12 |

root custom properties: claude.ai 1383, cairn 72

## settings / nav-page-1

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 352 vs 134

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 14, 32x32 | 1, 30.8x12.8 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| composer.box | count, size | 1, 343.2x88 | 1, 130.8x34.4 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.22) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 10px |
| composer.box | marginRight | 0px | 16px |
| composer.box | marginBottom | 0px | 10px |
| composer.box | marginLeft | 0px | 16px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 2, 11.2x11.2 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | rowGap | 6px | normal |
| composer.button | columnGap | 6px | normal |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.input | count, size | 1, 319.2x22 | 1, 119.6x14.4 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | presence | 1 | absent |
| dialog | count, size | 1, 343.2x780 | 3, 375x812 |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 400 | 450 |
| dialog | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog | backgroundColor | rgb(48, 48, 48) | rgb(27, 31, 28) |
| dialog | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderTopLeftRadius | 12px | 0px |
| dialog | borderTopRightRadius | 12px | 0px |
| dialog | borderBottomRightRadius | 12px | 0px |
| dialog | borderBottomLeftRadius | 12px | 0px |
| dialog | boxShadow | rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% 4.31373% / 0.08) 0px 4px 8px  | none |
| dialog | outlineWidth | 2.4px | 1px |
| dialog | outlineColor | rgb(81, 156, 237) | rgb(238, 238, 238) |
| dialog | maxWidth | 720px | none |
| dialog | transitionProperty | opacity, scale, filter | all |
| dialog | transitionDuration | 0.2s | 0s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | ease |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.5)","color":"rgba(255, 255, 255, 0.93)","radius":" | null |
| dialog.input | count, size | 11, 1x1 | 1, 311x32 |
| dialog.input | position | fixed | static |
| dialog.input | fontFamily | anthropic-sans | instrumentSans |
| dialog.input | fontSize | 14px | 16px |
| dialog.input | fontWeight | 400 | 450 |
| dialog.input | lineHeight | 20px | 24px |
| dialog.input | whiteSpace | nowrap | normal |
| dialog.input | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog.input | backgroundColor | rgba(0, 0, 0, 0) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| dialog.input | borderTopWidth | 0px | 1px |
| dialog.input | borderTopStyle | none | solid |
| dialog.input | borderTopColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderRightWidth | 0px | 1px |
| dialog.input | borderRightStyle | none | solid |
| dialog.input | borderRightColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderBottomWidth | 0px | 1px |
| dialog.input | borderBottomStyle | none | solid |
| dialog.input | borderBottomColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderLeftWidth | 0px | 1px |
| dialog.input | borderLeftStyle | none | solid |
| dialog.input | borderLeftColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderTopLeftRadius | 50% | 8px |
| dialog.input | borderTopRightRadius | 50% | 8px |
| dialog.input | borderBottomRightRadius | 50% | 8px |
| dialog.input | borderBottomLeftRadius | 50% | 8px |
| dialog.input | outlineWidth | 1.6px | 3px |
| dialog.input | outlineStyle | solid | none |
| dialog.input | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| dialog.input | outlineOffset | 1.6px | 0px |
| dialog.input | paddingTop | 0px | 4px |
| dialog.input | paddingRight | 0px | 10px |
| dialog.input | paddingBottom | 0px | 4px |
| dialog.input | paddingLeft | 0px | 10px |
| dialog.input | marginTop | -1px | 0px |
| dialog.input | marginRight | -1px | 0px |
| dialog.input | marginBottom | -1px | 0px |
| dialog.input | marginLeft | -1px | 0px |
| dialog.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.input | transitionDuration | 0s | 0.15s |
| dialog.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.input | cursor | default | text |
| dialog.radiogroup | presence | 1 | absent |
| dialog.select | count, size | 7, 191.9x32 | 1, 89.8x32 |
| dialog.select | fontFamily | anthropic-sans | instrumentSans |
| dialog.select | fontWeight | 435 | 450 |
| dialog.select | whiteSpace | normal | nowrap |
| dialog.select | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog.select | backgroundColor | rgba(0, 0, 0, 0) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| dialog.select | borderTopWidth | 0px | 1px |
| dialog.select | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderRightWidth | 0px | 1px |
| dialog.select | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderBottomWidth | 0px | 1px |
| dialog.select | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderLeftWidth | 0px | 1px |
| dialog.select | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderTopLeftRadius | 0px | 8px |
| dialog.select | borderTopRightRadius | 0px | 8px |
| dialog.select | borderBottomRightRadius | 0px | 8px |
| dialog.select | borderBottomLeftRadius | 0px | 8px |
| dialog.select | boxShadow | none | rgba(0, 0, 0, 0.3) 0px 1px 2px 0px |
| dialog.select | outlineWidth | 1.6px | 3px |
| dialog.select | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| dialog.select | outlineOffset | 1.6px | 0px |
| dialog.select | paddingTop | 0px | 8px |
| dialog.select | paddingRight | 0px | 8px |
| dialog.select | paddingBottom | 0px | 8px |
| dialog.select | paddingLeft | 8px | 10px |
| dialog.select | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.select | transitionDuration | 0s | 0.15s |
| dialog.select | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.select | cursor | pointer | default |
| dialog.select | textAlign | start | center |
| dialog.switch | presence | absent | 3 |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| project.card | presence | absent | 3 |
| shell.header | count, size | 1, 375.2x48 | 1, 143.6x16 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingTop | 0px | 4px |
| shell.header | paddingRight | 0px | 16px |
| shell.header | paddingBottom | 0px | 12px |
| shell.header | paddingLeft | 0px | 16px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.main | presence | 1 | absent |
| shell.sidebar | count, size | 1, 32x32 | 1, 143.6x240 |
| shell.sidebar | position | absolute | fixed |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | backgroundColor | rgba(0, 0, 0, 0) | rgb(34, 39, 35) |
| shell.sidebar | opacity | 1 | 0 |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderTopLeftRadius | 0px | 18px |
| shell.sidebar | borderTopRightRadius | 0px | 18px |
| shell.sidebar | borderBottomRightRadius | 0px | 18px |
| shell.sidebar | borderBottomLeftRadius | 0px | 18px |
| shell.sidebar | boxShadow | none | rgb(53, 59, 54) 0px 0px 0px 0.5px inset, rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0 |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.sidebar | maxWidth | none | 359px |
| shell.sidebar | transitionDuration | 0s | 0.2s |
| shell.sidebar | transitionTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| shell.sidebar | animationName | none | exit |
| shell.sidebar | animationDuration | 0s | 0.2s |
| shell.sidebar | animationTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | anthropic-sans x34<br>Anthropicons-Variable x23<br>anthropic-serif x2 | instrumentSans x27<br>sourceSerif4 x1 |
| fontSize (7 vs 6) | 14px x24<br>16px x11<br>20px x10<br>13px x6<br>12px x4<br>15px x3<br>24px x1 | 14px x17<br>13px x6<br>17px x2<br>20px x1<br>16px x1<br>15px x1 |
| fontWeight (7 vs 4) | 435 x17<br>400 x15<br>433.25 x10<br>533.25 x10<br>577.75 x3<br>520 x3<br>360 x1 | 450 x18<br>500 x7<br>650 x2<br>600 x1 |
| lineHeight (8 vs 6) | 20px x36<br>16px x12<br>19px x4<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>17px x1 | 20px x17<br>18px x6<br>24px x2<br>26px x1<br>22px x1<br>22.5px x1 |
| letterSpacing (1 vs 2) | normal x59 | normal x27<br>-0.35px x1 |
| color (4 vs 4) | rgba(255, 255, 255, 0.93) x42<br>rgba(255, 255, 255, 0.57) x13<br>rgba(255, 255, 255, 0.4) x3<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x17<br>rgb(163, 170, 164) x6<br>rgb(180, 186, 179) x4<br>rgb(22, 26, 23) x1 |
| backgroundColor (9 vs 9) | rgb(25, 25, 25) x6<br>rgb(31, 31, 31) x4<br>rgb(48, 48, 48) x3<br>hsl(none 0% 100% / 0.05) x3<br>rgba(251, 179, 21, 0.08) x2<br>hsl(none 0% 9.80392%) x1<br>rgba(255, 255, 255, 0.05) x1<br>rgba(0, 0, 0, 0.5) x1<br>hsl(none 0% 100% / 0.1) x1 | rgb(34, 39, 35) x12<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x3<br>rgb(67, 74, 68) x3<br>rgb(255, 255, 255) x3<br>rgb(20, 23, 21) x1<br>rgba(0, 0, 0, 0.6) x1<br>rgb(27, 31, 28) x1<br>rgb(230, 232, 226) x1<br>rgb(42, 48, 43) x1 |
| borderTopLeftRadius (7 vs 4) | 8px x55<br>6px x12<br>11px x8<br>7px x5<br>50% x3<br>12px x2<br>14px x1 | 14px x11<br>3.35544e+07px x10<br>8px x7<br>18px x1 |
| boxShadow (7 vs 6) | hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 100% / 0.1) 0px 0px 0px 1px x2<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% x1<br>hsl(none 0% 100% / 0.2) 0px 0px 0px 1px x1 | rgb(53, 59, 54) 0px 0px 0px 1px x4<br>rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x3<br>oklab(0.927781 -0.00430253 0.00707078 / 0.08) 0px 0px 0px 1p x1<br>rgba(0, 0, 0, 0.3) 0px 1px 2px 0px x1<br>rgb(53, 59, 54) 0px 0px 0px 0.5px inset, rgba(0, 0, 0, 0.4)  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (2 vs 2) | hsl(none 0% 100% / 0.05) x5<br>hsl(none 0% 100% / 0.2) x4 | rgba(0, 0, 0, 0) x3<br>rgb(107, 114, 108) x3 |
| borderTopWidth (1 vs 1) | 0.8px x9 | 1px x6 |
| paddingTop (7 vs 8) | 8px x9<br>12px x7<br>5px x3<br>16px x2<br>14px x2<br>4px x2<br>1px x1 | 12px x5<br>16px x4<br>6px x4<br>2px x3<br>4px x2<br>8px x1<br>24px x1<br>14px x1 |
| paddingLeft (7 vs 7) | 8px x22<br>12px x9<br>4px x4<br>16px x3<br>1px x2<br>14px x2<br>23.04px x1 | 16px x12<br>2px x6<br>12px x5<br>10px x3<br>4px x1<br>24px x1<br>14px x1 |
| rowGap (9 vs 8) | 6px x39<br>4px x30<br>12px x9<br>8px x7<br>28px x3<br>24px x1<br>2px x1<br>5px x1<br>16px x1 | 12px x10<br>16px x7<br>8px x4<br>6px x4<br>2px x2<br>10px x2<br>24px x1<br>4px x1 |
| columnGap (9 vs 8) | 6px x39<br>4px x30<br>12px x9<br>8px x5<br>28px x3<br>24px x1<br>2px x1<br>5px x1<br>16px x1 | 12px x10<br>16px x7<br>8px x4<br>6px x4<br>2px x2<br>10px x2<br>24px x1<br>4px x1 |
| transitionDuration (8 vs 2) | 0.06s x47<br>0.45s x18<br>0.2s x18<br>0.15s x8<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x11<br>0.2s x1 |
| transitionTimingFunction (5 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x44<br>cubic-bezier(0.165, 0.84, 0.44, 1) x34<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x18<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x11<br>cubic-bezier(0.32, 0.72, 0, 1) x1 |
| animationName (5 vs 1) | static-composer-actions-fade-in x4<br>task-grid-fade-in, task-grid-clip-reveal x1<br>cds-fade-in x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1<br>cds-scroll-fade-left, cds-scroll-fade-right, cds-scroll-fade x1 | exit x1 |
| strokeWidth (2 vs 1) | 1.25px x2<br>1px x1 | 1.75px x12 |

root custom properties: claude.ai 1383, cairn 72

## settings / nav-page-2

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 352 vs 134

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 14, 32x32 | 1, 30.8x12.8 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| composer.box | count, size | 1, 343.2x88 | 1, 130.8x34.4 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.22) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 10px |
| composer.box | marginRight | 0px | 16px |
| composer.box | marginBottom | 0px | 10px |
| composer.box | marginLeft | 0px | 16px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 2, 11.2x11.2 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | rowGap | 6px | normal |
| composer.button | columnGap | 6px | normal |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.input | count, size | 1, 319.2x22 | 1, 119.6x14.4 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | presence | 1 | absent |
| dialog | count, size | 1, 343.2x780 | 3, 375x812 |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 400 | 450 |
| dialog | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog | backgroundColor | rgb(48, 48, 48) | rgb(27, 31, 28) |
| dialog | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderTopLeftRadius | 12px | 0px |
| dialog | borderTopRightRadius | 12px | 0px |
| dialog | borderBottomRightRadius | 12px | 0px |
| dialog | borderBottomLeftRadius | 12px | 0px |
| dialog | boxShadow | rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% 4.31373% / 0.08) 0px 4px 8px  | none |
| dialog | outlineWidth | 2.4px | 3px |
| dialog | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| dialog | maxWidth | 720px | none |
| dialog | transitionProperty | opacity, scale, filter | all |
| dialog | transitionDuration | 0.2s | 0s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | ease |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.5)","color":"rgba(255, 255, 255, 0.93)","radius":" | null |
| dialog.input | count, size | 11, 1x1 | 1, 311x32 |
| dialog.input | position | fixed | static |
| dialog.input | fontFamily | anthropic-sans | instrumentSans |
| dialog.input | fontSize | 14px | 16px |
| dialog.input | fontWeight | 400 | 450 |
| dialog.input | lineHeight | 20px | 24px |
| dialog.input | whiteSpace | nowrap | normal |
| dialog.input | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog.input | backgroundColor | rgba(0, 0, 0, 0) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| dialog.input | borderTopWidth | 0px | 1px |
| dialog.input | borderTopStyle | none | solid |
| dialog.input | borderTopColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderRightWidth | 0px | 1px |
| dialog.input | borderRightStyle | none | solid |
| dialog.input | borderRightColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderBottomWidth | 0px | 1px |
| dialog.input | borderBottomStyle | none | solid |
| dialog.input | borderBottomColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderLeftWidth | 0px | 1px |
| dialog.input | borderLeftStyle | none | solid |
| dialog.input | borderLeftColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderTopLeftRadius | 50% | 8px |
| dialog.input | borderTopRightRadius | 50% | 8px |
| dialog.input | borderBottomRightRadius | 50% | 8px |
| dialog.input | borderBottomLeftRadius | 50% | 8px |
| dialog.input | outlineWidth | 1.6px | 3px |
| dialog.input | outlineStyle | solid | none |
| dialog.input | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| dialog.input | outlineOffset | 1.6px | 0px |
| dialog.input | paddingTop | 0px | 4px |
| dialog.input | paddingRight | 0px | 10px |
| dialog.input | paddingBottom | 0px | 4px |
| dialog.input | paddingLeft | 0px | 10px |
| dialog.input | marginTop | -1px | 0px |
| dialog.input | marginRight | -1px | 0px |
| dialog.input | marginBottom | -1px | 0px |
| dialog.input | marginLeft | -1px | 0px |
| dialog.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.input | transitionDuration | 0s | 0.15s |
| dialog.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.input | cursor | default | text |
| dialog.radiogroup | presence | 1 | absent |
| dialog.select | count, size | 7, 191.9x32 | 1, 89.8x32 |
| dialog.select | fontFamily | anthropic-sans | instrumentSans |
| dialog.select | fontWeight | 435 | 450 |
| dialog.select | whiteSpace | normal | nowrap |
| dialog.select | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog.select | backgroundColor | rgba(0, 0, 0, 0) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| dialog.select | borderTopWidth | 0px | 1px |
| dialog.select | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(156, 199, 139) |
| dialog.select | borderRightWidth | 0px | 1px |
| dialog.select | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(156, 199, 139) |
| dialog.select | borderBottomWidth | 0px | 1px |
| dialog.select | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(156, 199, 139) |
| dialog.select | borderLeftWidth | 0px | 1px |
| dialog.select | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(156, 199, 139) |
| dialog.select | borderTopLeftRadius | 0px | 8px |
| dialog.select | borderTopRightRadius | 0px | 8px |
| dialog.select | borderBottomRightRadius | 0px | 8px |
| dialog.select | borderBottomLeftRadius | 0px | 8px |
| dialog.select | boxShadow | none | color(srgb 0.611765 0.780392 0.545098 / 0.22) 0px 0px 0px 3px |
| dialog.select | outlineWidth | 1.6px | 3px |
| dialog.select | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| dialog.select | outlineOffset | 1.6px | 2px |
| dialog.select | paddingTop | 0px | 8px |
| dialog.select | paddingRight | 0px | 8px |
| dialog.select | paddingBottom | 0px | 8px |
| dialog.select | paddingLeft | 8px | 10px |
| dialog.select | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.select | transitionDuration | 0s | 0.15s |
| dialog.select | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.select | cursor | pointer | default |
| dialog.select | textAlign | start | center |
| dialog.switch | presence | absent | 3 |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| project.card | presence | absent | 3 |
| shell.header | count, size | 1, 375.2x48 | 1, 143.6x16 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingTop | 0px | 4px |
| shell.header | paddingRight | 0px | 16px |
| shell.header | paddingBottom | 0px | 12px |
| shell.header | paddingLeft | 0px | 16px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.main | presence | 1 | absent |
| shell.sidebar | count, size | 1, 32x32 | 1, 143.6x240 |
| shell.sidebar | position | absolute | fixed |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | backgroundColor | rgba(0, 0, 0, 0) | rgb(34, 39, 35) |
| shell.sidebar | opacity | 1 | 0 |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderTopLeftRadius | 0px | 18px |
| shell.sidebar | borderTopRightRadius | 0px | 18px |
| shell.sidebar | borderBottomRightRadius | 0px | 18px |
| shell.sidebar | borderBottomLeftRadius | 0px | 18px |
| shell.sidebar | boxShadow | none | rgb(53, 59, 54) 0px 0px 0px 0.5px inset, rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0 |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.sidebar | maxWidth | none | 359px |
| shell.sidebar | transitionDuration | 0s | 0.2s |
| shell.sidebar | transitionTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| shell.sidebar | animationName | none | exit |
| shell.sidebar | animationDuration | 0s | 0.2s |
| shell.sidebar | animationTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | anthropic-sans x34<br>Anthropicons-Variable x23<br>anthropic-serif x2 | instrumentSans x27<br>sourceSerif4 x1 |
| fontSize (7 vs 6) | 14px x24<br>16px x11<br>20px x10<br>13px x6<br>12px x4<br>15px x3<br>24px x1 | 14px x17<br>13px x6<br>17px x2<br>20px x1<br>16px x1<br>15px x1 |
| fontWeight (7 vs 4) | 435 x17<br>400 x15<br>433.25 x10<br>533.25 x10<br>577.75 x3<br>520 x3<br>360 x1 | 450 x18<br>500 x7<br>650 x2<br>600 x1 |
| lineHeight (8 vs 6) | 20px x36<br>16px x12<br>19px x4<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>17px x1 | 20px x17<br>18px x6<br>24px x2<br>26px x1<br>22px x1<br>22.5px x1 |
| letterSpacing (1 vs 2) | normal x59 | normal x27<br>-0.35px x1 |
| color (4 vs 4) | rgba(255, 255, 255, 0.93) x42<br>rgba(255, 255, 255, 0.57) x13<br>rgba(255, 255, 255, 0.4) x3<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x17<br>rgb(163, 170, 164) x6<br>rgb(180, 186, 179) x4<br>rgb(22, 26, 23) x1 |
| backgroundColor (9 vs 9) | rgb(25, 25, 25) x6<br>rgb(31, 31, 31) x4<br>rgb(48, 48, 48) x3<br>hsl(none 0% 100% / 0.05) x3<br>rgba(251, 179, 21, 0.08) x2<br>hsl(none 0% 9.80392%) x1<br>rgba(255, 255, 255, 0.05) x1<br>rgba(0, 0, 0, 0.5) x1<br>hsl(none 0% 100% / 0.1) x1 | rgb(34, 39, 35) x12<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x3<br>rgb(67, 74, 68) x3<br>rgb(255, 255, 255) x3<br>rgb(20, 23, 21) x1<br>rgba(0, 0, 0, 0.6) x1<br>rgb(27, 31, 28) x1<br>rgb(230, 232, 226) x1<br>rgb(42, 48, 43) x1 |
| borderTopLeftRadius (7 vs 4) | 8px x55<br>6px x12<br>11px x8<br>7px x5<br>50% x3<br>12px x2<br>14px x1 | 14px x11<br>3.35544e+07px x10<br>8px x7<br>18px x1 |
| boxShadow (7 vs 6) | hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 100% / 0.1) 0px 0px 0px 1px x2<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% x1<br>hsl(none 0% 100% / 0.2) 0px 0px 0px 1px x1 | rgb(53, 59, 54) 0px 0px 0px 1px x4<br>rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x3<br>oklab(0.927781 -0.00430253 0.00707078 / 0.08) 0px 0px 0px 1p x1<br>color(srgb 0.611765 0.780392 0.545098 / 0.22) 0px 0px 0px 3p x1<br>rgb(53, 59, 54) 0px 0px 0px 0.5px inset, rgba(0, 0, 0, 0.4)  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (2 vs 3) | hsl(none 0% 100% / 0.05) x5<br>hsl(none 0% 100% / 0.2) x4 | rgba(0, 0, 0, 0) x3<br>rgb(107, 114, 108) x2<br>rgb(156, 199, 139) x1 |
| borderTopWidth (1 vs 1) | 0.8px x9 | 1px x6 |
| paddingTop (7 vs 8) | 8px x9<br>12px x7<br>5px x3<br>16px x2<br>14px x2<br>4px x2<br>1px x1 | 12px x5<br>16px x4<br>6px x4<br>2px x3<br>4px x2<br>8px x1<br>24px x1<br>14px x1 |
| paddingLeft (7 vs 7) | 8px x22<br>12px x9<br>4px x4<br>16px x3<br>1px x2<br>14px x2<br>23.04px x1 | 16px x12<br>2px x6<br>12px x5<br>10px x3<br>4px x1<br>24px x1<br>14px x1 |
| rowGap (9 vs 8) | 6px x39<br>4px x30<br>12px x9<br>8px x7<br>28px x3<br>24px x1<br>2px x1<br>5px x1<br>16px x1 | 12px x10<br>16px x7<br>8px x4<br>6px x4<br>2px x2<br>10px x2<br>24px x1<br>4px x1 |
| columnGap (9 vs 8) | 6px x39<br>4px x30<br>12px x9<br>8px x5<br>28px x3<br>24px x1<br>2px x1<br>5px x1<br>16px x1 | 12px x10<br>16px x7<br>8px x4<br>6px x4<br>2px x2<br>10px x2<br>24px x1<br>4px x1 |
| transitionDuration (8 vs 2) | 0.06s x47<br>0.45s x18<br>0.2s x18<br>0.15s x8<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x11<br>0.2s x1 |
| transitionTimingFunction (5 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x44<br>cubic-bezier(0.165, 0.84, 0.44, 1) x34<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x18<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x11<br>cubic-bezier(0.32, 0.72, 0, 1) x1 |
| animationName (5 vs 1) | static-composer-actions-fade-in x4<br>task-grid-fade-in, task-grid-clip-reveal x1<br>cds-fade-in x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1<br>cds-scroll-fade-left, cds-scroll-fade-right, cds-scroll-fade x1 | exit x1 |
| strokeWidth (2 vs 1) | 1.25px x2<br>1px x1 | 1.75px x12 |

root custom properties: claude.ai 1383, cairn 72

## settings / open-select

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 352 vs 147

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 14, 32x32 | 1, 30.8x12.8 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| composer.box | count, size | 1, 343.2x88 | 1, 130.8x34.4 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| composer.box | backgroundColor | rgb(48, 48, 48) | rgb(34, 39, 35) |
| composer.box | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inse | rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.909804 0.886275 / 0.22) 0px 0px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 10px |
| composer.box | marginRight | 0px | 16px |
| composer.box | marginBottom | 0px | 10px |
| composer.box | marginLeft | 0px | 16px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 32x32 | 2, 11.2x11.2 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | color | rgba(255, 255, 255, 0.93) | rgb(163, 170, 164) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(81, 156, 237, 0) | rgb(163, 170, 164) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | rowGap | 6px | normal |
| composer.button | columnGap | 6px | normal |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.input | count, size | 1, 319.2x22 | 1, 119.6x14.4 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 16px | 15px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 22px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(255, 255, 255, 0.93) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(81, 156, 237) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | presence | 1 | absent |
| dialog | count, size | 1, 343.2x780 | 3, 375x812 |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 400 | 450 |
| dialog | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog | backgroundColor | rgb(48, 48, 48) | rgb(27, 31, 28) |
| dialog | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| dialog | borderTopLeftRadius | 12px | 0px |
| dialog | borderTopRightRadius | 12px | 0px |
| dialog | borderBottomRightRadius | 12px | 0px |
| dialog | borderBottomLeftRadius | 12px | 0px |
| dialog | boxShadow | rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% 4.31373% / 0.08) 0px 4px 8px  | none |
| dialog | outlineWidth | 2.4px | 3px |
| dialog | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| dialog | maxWidth | 720px | none |
| dialog | transitionProperty | opacity, scale, filter | all |
| dialog | transitionDuration | 0.2s | 0s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | ease |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.5)","color":"rgba(255, 255, 255, 0.93)","radius":" | null |
| dialog.input | count, size | 11, 1x1 | 1, 311x32 |
| dialog.input | position | fixed | static |
| dialog.input | fontFamily | anthropic-sans | instrumentSans |
| dialog.input | fontSize | 14px | 16px |
| dialog.input | fontWeight | 400 | 450 |
| dialog.input | lineHeight | 20px | 24px |
| dialog.input | whiteSpace | nowrap | normal |
| dialog.input | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog.input | backgroundColor | rgba(0, 0, 0, 0) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| dialog.input | borderTopWidth | 0px | 1px |
| dialog.input | borderTopStyle | none | solid |
| dialog.input | borderTopColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderRightWidth | 0px | 1px |
| dialog.input | borderRightStyle | none | solid |
| dialog.input | borderRightColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderBottomWidth | 0px | 1px |
| dialog.input | borderBottomStyle | none | solid |
| dialog.input | borderBottomColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderLeftWidth | 0px | 1px |
| dialog.input | borderLeftStyle | none | solid |
| dialog.input | borderLeftColor | rgba(255, 255, 255, 0.93) | rgb(107, 114, 108) |
| dialog.input | borderTopLeftRadius | 50% | 8px |
| dialog.input | borderTopRightRadius | 50% | 8px |
| dialog.input | borderBottomRightRadius | 50% | 8px |
| dialog.input | borderBottomLeftRadius | 50% | 8px |
| dialog.input | outlineWidth | 1.6px | 3px |
| dialog.input | outlineStyle | solid | none |
| dialog.input | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| dialog.input | outlineOffset | 1.6px | 0px |
| dialog.input | paddingTop | 0px | 4px |
| dialog.input | paddingRight | 0px | 10px |
| dialog.input | paddingBottom | 0px | 4px |
| dialog.input | paddingLeft | 0px | 10px |
| dialog.input | marginTop | -1px | 0px |
| dialog.input | marginRight | -1px | 0px |
| dialog.input | marginBottom | -1px | 0px |
| dialog.input | marginLeft | -1px | 0px |
| dialog.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.input | transitionDuration | 0s | 0.15s |
| dialog.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.input | cursor | default | text |
| dialog.radiogroup | presence | 1 | absent |
| dialog.select | count, size | 7, 191.9x32 | 1, 89.8x32 |
| dialog.select | fontFamily | anthropic-sans | instrumentSans |
| dialog.select | fontWeight | 435 | 450 |
| dialog.select | whiteSpace | normal | nowrap |
| dialog.select | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| dialog.select | backgroundColor | rgba(0, 0, 0, 0) | oklab(0.544174 -0.0107603 0.00631091 / 0.3) |
| dialog.select | borderTopWidth | 0px | 1px |
| dialog.select | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderRightWidth | 0px | 1px |
| dialog.select | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderBottomWidth | 0px | 1px |
| dialog.select | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderLeftWidth | 0px | 1px |
| dialog.select | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(107, 114, 108) |
| dialog.select | borderTopLeftRadius | 0px | 8px |
| dialog.select | borderTopRightRadius | 0px | 8px |
| dialog.select | borderBottomRightRadius | 0px | 8px |
| dialog.select | borderBottomLeftRadius | 0px | 8px |
| dialog.select | boxShadow | none | rgba(0, 0, 0, 0.3) 0px 1px 2px 0px |
| dialog.select | outlineWidth | 1.6px | 3px |
| dialog.select | outlineColor | rgba(81, 156, 237, 0) | rgb(230, 232, 226) |
| dialog.select | outlineOffset | 1.6px | 0px |
| dialog.select | paddingTop | 0px | 8px |
| dialog.select | paddingRight | 0px | 8px |
| dialog.select | paddingBottom | 0px | 8px |
| dialog.select | paddingLeft | 8px | 10px |
| dialog.select | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.select | transitionDuration | 0s | 0.15s |
| dialog.select | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.select | cursor | pointer | default |
| dialog.select | textAlign | start | center |
| dialog.switch | presence | absent | 3 |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| listbox | presence | absent | 1 |
| project.card | presence | absent | 3 |
| shell.header | count, size | 1, 375.2x48 | 1, 143.6x16 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingTop | 0px | 4px |
| shell.header | paddingRight | 0px | 16px |
| shell.header | paddingBottom | 0px | 12px |
| shell.header | paddingLeft | 0px | 16px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.main | presence | 1 | absent |
| shell.sidebar | count, size | 1, 32x32 | 1, 143.6x240 |
| shell.sidebar | position | absolute | fixed |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | backgroundColor | rgba(0, 0, 0, 0) | rgb(34, 39, 35) |
| shell.sidebar | opacity | 1 | 0 |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| shell.sidebar | borderTopLeftRadius | 0px | 18px |
| shell.sidebar | borderTopRightRadius | 0px | 18px |
| shell.sidebar | borderBottomRightRadius | 0px | 18px |
| shell.sidebar | borderBottomLeftRadius | 0px | 18px |
| shell.sidebar | boxShadow | none | rgb(53, 59, 54) 0px 0px 0px 0.5px inset, rgba(0, 0, 0, 0.4) 0px 4px 12px 0px, rgba(0, 0, 0 |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.sidebar | maxWidth | none | 359px |
| shell.sidebar | transitionDuration | 0s | 0.2s |
| shell.sidebar | transitionTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| shell.sidebar | animationName | none | exit |
| shell.sidebar | animationDuration | 0s | 0.2s |
| shell.sidebar | animationTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | anthropic-sans x34<br>Anthropicons-Variable x23<br>anthropic-serif x2 | instrumentSans x29<br>sourceSerif4 x1 |
| fontSize (7 vs 6) | 14px x24<br>16px x11<br>20px x10<br>13px x6<br>12px x4<br>15px x3<br>24px x1 | 14px x19<br>13px x6<br>17px x2<br>20px x1<br>16px x1<br>15px x1 |
| fontWeight (7 vs 4) | 435 x17<br>400 x15<br>433.25 x10<br>533.25 x10<br>577.75 x3<br>520 x3<br>360 x1 | 450 x20<br>500 x7<br>650 x2<br>600 x1 |
| lineHeight (8 vs 6) | 20px x36<br>16px x12<br>19px x4<br>12px x3<br>21px x1<br>28.8px x1<br>22px x1<br>17px x1 | 20px x19<br>18px x6<br>24px x2<br>26px x1<br>22px x1<br>22.5px x1 |
| letterSpacing (1 vs 2) | normal x59 | normal x29<br>-0.35px x1 |
| color (4 vs 4) | rgba(255, 255, 255, 0.93) x42<br>rgba(255, 255, 255, 0.57) x13<br>rgba(255, 255, 255, 0.4) x3<br>rgb(135, 135, 135) x1 | rgb(230, 232, 226) x19<br>rgb(163, 170, 164) x6<br>rgb(180, 186, 179) x4<br>rgb(22, 26, 23) x1 |
| backgroundColor (9 vs 11) | rgb(25, 25, 25) x6<br>rgb(31, 31, 31) x4<br>rgb(48, 48, 48) x3<br>hsl(none 0% 100% / 0.05) x3<br>rgba(251, 179, 21, 0.08) x2<br>hsl(none 0% 9.80392%) x1<br>rgba(255, 255, 255, 0.05) x1<br>rgba(0, 0, 0, 0.5) x1<br>hsl(none 0% 100% / 0.1) x1 | rgb(34, 39, 35) x12<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x3<br>rgb(67, 74, 68) x3<br>rgb(255, 255, 255) x3<br>rgb(20, 23, 21) x1<br>rgba(0, 0, 0, 0.6) x1<br>rgb(27, 31, 28) x1<br>rgb(230, 232, 226) x1<br>rgb(42, 48, 43) x1<br>rgb(38, 43, 39) x1<br>rgba(230, 232, 226, 0.1) x1 |
| borderTopLeftRadius (7 vs 5) | 8px x55<br>6px x12<br>11px x8<br>7px x5<br>50% x3<br>12px x2<br>14px x1 | 14px x11<br>3.35544e+07px x10<br>8px x9<br>18px x1<br>12px x1 |
| boxShadow (7 vs 7) | hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, rgba(0, 0, 0,  x2<br>hsl(none 0% 100% / 0.1) 0px 0px 0px 1px x2<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(255, 255, 2 x1<br>rgba(255, 255, 255, 0.04) 0px 0px 0px 1px inset, hsl(none 0% x1<br>hsl(none 0% 100% / 0.2) 0px 0px 0px 1px x1 | rgb(53, 59, 54) 0px 0px 0px 1px x4<br>rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x3<br>oklab(0.927781 -0.00430253 0.00707078 / 0.08) 0px 0px 0px 1p x1<br>rgba(0, 0, 0, 0.3) 0px 1px 2px 0px x1<br>rgb(53, 59, 54) 0px 0px 0px 0.5px inset, rgba(0, 0, 0, 0.4)  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1<br>rgba(0, 0, 0, 0.4) 0px 2px 6px 0px, rgba(0, 0, 0, 0.45) 0px  x1 |
| borderTopColor (2 vs 2) | hsl(none 0% 100% / 0.05) x5<br>hsl(none 0% 100% / 0.2) x4 | rgba(0, 0, 0, 0) x3<br>rgb(107, 114, 108) x3 |
| borderTopWidth (1 vs 1) | 0.8px x9 | 1px x6 |
| paddingTop (7 vs 8) | 8px x9<br>12px x7<br>5px x3<br>16px x2<br>14px x2<br>4px x2<br>1px x1 | 12px x5<br>16px x4<br>6px x4<br>4px x3<br>2px x3<br>8px x1<br>24px x1<br>14px x1 |
| paddingLeft (7 vs 7) | 8px x22<br>12px x9<br>4px x4<br>16px x3<br>1px x2<br>14px x2<br>23.04px x1 | 16px x12<br>2px x6<br>12px x5<br>10px x5<br>4px x2<br>24px x1<br>14px x1 |
| rowGap (9 vs 8) | 6px x39<br>4px x30<br>12px x9<br>8px x7<br>28px x3<br>24px x1<br>2px x1<br>5px x1<br>16px x1 | 12px x10<br>8px x7<br>16px x7<br>6px x4<br>10px x4<br>2px x2<br>24px x1<br>4px x1 |
| columnGap (9 vs 8) | 6px x39<br>4px x30<br>12px x9<br>8px x5<br>28px x3<br>24px x1<br>2px x1<br>5px x1<br>16px x1 | 12px x10<br>8px x7<br>16px x7<br>6px x4<br>10px x4<br>2px x2<br>24px x1<br>4px x1 |
| transitionDuration (8 vs 3) | 0.06s x47<br>0.45s x18<br>0.2s x18<br>0.15s x8<br>0.28s x3<br>0.12s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x11<br>0.2s x1<br>0.1s x1 |
| transitionTimingFunction (5 vs 3) | cubic-bezier(0.4, 0, 0.2, 1) x44<br>cubic-bezier(0.165, 0.84, 0.44, 1) x34<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x18<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x11<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease x1 |
| animationName (4 vs 2) | task-grid-fade-in, task-grid-clip-reveal x1<br>cds-fade-in x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1<br>cds-scroll-fade-left, cds-scroll-fade-right, cds-scroll-fade x1 | exit x1<br>enter x1 |
| strokeWidth (2 vs 1) | 1.25px x2<br>1px x1 | 1.75px x13 |

root custom properties: claude.ai 1383, cairn 72

## projects / initial

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 136 vs 66

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 7, 32x32 | 2, 77x32 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| composer.box | presence | absent | 1 |
| composer.button | presence | absent | 5 |
| composer.input | presence | absent | 1 |
| composer.model | presence | absent | 1 |
| home.greeting | count, size | 1, 91.3x32 | 1, 343x32 |
| home.greeting | fontFamily | anthropic-serif | sourceSerif4 |
| home.greeting | fontSize | 24px | 26px |
| home.greeting | fontWeight | 500 | 600 |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | whiteSpace | normal | nowrap |
| home.greeting | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| home.greeting | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| home.greeting | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| home.greeting | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| home.greeting | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| project.card | count, size | 3, 351.2x64 | 1, 343x38 |
| project.card | fontFamily | anthropic-sans | instrumentSans |
| project.card | fontWeight | 400 | 450 |
| project.card | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| project.card | backgroundColor | rgba(0, 0, 0, 0) | rgb(34, 39, 35) |
| project.card | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| project.card | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| project.card | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| project.card | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| project.card | borderTopLeftRadius | 12px | 14px |
| project.card | borderTopRightRadius | 12px | 14px |
| project.card | borderBottomRightRadius | 12px | 14px |
| project.card | borderBottomLeftRadius | 12px | 14px |
| project.card | boxShadow | none | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px 2px 8px 0px, rgb(53, 59, 54) 0 |
| project.card | outlineWidth | 2.4px | 3px |
| project.card | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| project.card | paddingTop | 16px | 6px |
| project.card | paddingRight | 16px | 12px |
| project.card | paddingBottom | 16px | 6px |
| project.card | paddingLeft | 16px | 12px |
| project.card | rowGap | 12px | 8px |
| project.card | columnGap | 12px | 10px |
| project.card | transitionProperty | clip-path | all |
| project.card | transitionDuration | 0.45s | 0s |
| project.card | transitionTimingFunction | linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.4286%, 1.0764 28.5714%, 1.0915 35 | ease |
| project.card | listStyleType | none | disc |
| shell.header | count, size | 1, 351.2x64 | 2, 375x48 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingBottom | 16px | 0px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | rowGap | 16px | 2px |
| shell.header | columnGap | 16px | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | anthropic-sans x14<br>Anthropicons-Variable x10<br>anthropic-serif x1 | instrumentSans x13<br>sourceSerif4 x1 |
| fontSize (4 vs 4) | 20px x10<br>14px x7<br>13px x7<br>24px x1 | 13px x7<br>14px x5<br>26px x1<br>15px x1 |
| fontWeight (4 vs 3) | 433.25 x10<br>400 x10<br>435 x4<br>500 x1 | 450 x7<br>600 x4<br>500 x3 |
| lineHeight (4 vs 5) | 20px x14<br>17px x7<br>21px x3<br>32px x1 | 18px x7<br>20px x4<br>32px x1<br>21px x1<br>22.5px x1 |
| letterSpacing (1 vs 2) | normal x25 | normal x13<br>-0.26px x1 |
| color (6 vs 4) | rgba(255, 255, 255, 0.93) x14<br>rgba(255, 255, 255, 0.57) x7<br>rgb(25, 25, 25) x1<br>rgb(51, 185, 59) x1<br>rgb(210, 142, 5) x1<br>rgb(244, 114, 48) x1 | rgb(230, 232, 226) x5<br>rgb(180, 186, 179) x4<br>rgb(163, 170, 164) x3<br>rgb(22, 26, 23) x2 |
| backgroundColor (7 vs 8) | rgb(25, 25, 25) x1<br>hsl(none 0% 9.80392%) x1<br>rgb(239, 239, 239) x1<br>color(srgb 0.0980392 0.0980392 0.0980392 / 0.85) x1<br>oklab(0.689759 -0.162042 0.118793 / 0.1) x1<br>oklab(0.697681 0.0384636 0.141262 / 0.1) x1<br>oklab(0.697647 0.126706 0.123785 / 0.1) x1 | rgb(34, 39, 35) x3<br>rgb(230, 232, 226) x2<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1<br>rgb(42, 48, 43) x1 |
| borderTopLeftRadius (3 vs 3) | 8px x16<br>7px x12<br>12px x9 | 8px x9<br>3.35544e+07px x3<br>14px x3 |
| boxShadow (0 vs 3) |  | rgb(53, 59, 54) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (0 vs 2) |  | rgba(0, 0, 0, 0) x8<br>rgb(107, 114, 108) x1 |
| borderTopWidth (0 vs 1) |  | 1px x9 |
| paddingTop (2 vs 4) | 16px x3<br>4px x1 | 2px x3<br>48.72px x1<br>6px x1<br>12px x1 |
| paddingLeft (4 vs 8) | 12px x3<br>16px x3<br>42px x1<br>8px x1 | 2px x3<br>10px x2<br>9px x2<br>56px x1<br>16px x1<br>4px x1<br>12px x1<br>14px x1 |
| rowGap (6 vs 5) | 6px x14<br>4px x11<br>12px x10<br>8px x4<br>2px x3<br>16px x1 | 6px x4<br>2px x3<br>8px x3<br>4px x2<br>12px x1 |
| columnGap (6 vs 6) | 6px x14<br>4px x11<br>12px x10<br>8px x4<br>2px x3<br>16px x1 | 6px x4<br>2px x3<br>8px x2<br>4px x2<br>12px x1<br>10px x1 |
| transitionDuration (4 vs 1) | 0.06s x19<br>0.45s x14<br>0.5s x1<br>0.12s x1 | 0.15s x2 |
| transitionTimingFunction (4 vs 1) | linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x14<br>cubic-bezier(0.4, 0, 0.2, 1) x12<br>cubic-bezier(0.165, 0.84, 0.44, 1) x8<br>ease-out x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (1 vs 0) | task-grid-fade-in, task-grid-clip-reveal x1 |  |
| strokeWidth (0 vs 2) |  | 1.75px x7<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## projects / hover-cards

viewport claude.ai 375x812x2.0000000298023224, cairn 375x812x2; elements 136 vs 66

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 7, 32x32 | 2, 77x32 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(255, 255, 255, 0.93) | rgb(22, 26, 23) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 232, 226) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(255, 255, 255, 0.04) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(81, 156, 237, 0) | rgb(22, 26, 23) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| composer.box | presence | absent | 1 |
| composer.button | presence | absent | 5 |
| composer.input | presence | absent | 1 |
| composer.model | presence | absent | 1 |
| home.greeting | count, size | 1, 91.3x32 | 1, 343x32 |
| home.greeting | fontFamily | anthropic-serif | sourceSerif4 |
| home.greeting | fontSize | 24px | 26px |
| home.greeting | fontWeight | 500 | 600 |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | whiteSpace | normal | nowrap |
| home.greeting | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| home.greeting | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| home.greeting | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| home.greeting | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| home.greeting | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| project.card | count, size | 3, 351.2x64 | 1, 343x38 |
| project.card | fontFamily | anthropic-sans | instrumentSans |
| project.card | fontWeight | 400 | 450 |
| project.card | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| project.card | backgroundColor | rgba(0, 0, 0, 0) | rgb(34, 39, 35) |
| project.card | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| project.card | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| project.card | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| project.card | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(53, 59, 54) |
| project.card | borderTopLeftRadius | 12px | 14px |
| project.card | borderTopRightRadius | 12px | 14px |
| project.card | borderBottomRightRadius | 12px | 14px |
| project.card | borderBottomLeftRadius | 12px | 14px |
| project.card | boxShadow | none | rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px 2px 8px 0px, rgb(53, 59, 54) 0 |
| project.card | outlineWidth | 2.4px | 3px |
| project.card | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| project.card | paddingTop | 16px | 6px |
| project.card | paddingRight | 16px | 12px |
| project.card | paddingBottom | 16px | 6px |
| project.card | paddingLeft | 16px | 12px |
| project.card | rowGap | 12px | 8px |
| project.card | columnGap | 12px | 10px |
| project.card | transitionProperty | clip-path | all |
| project.card | transitionDuration | 0.45s | 0s |
| project.card | transitionTimingFunction | linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.4286%, 1.0764 28.5714%, 1.0915 35 | ease |
| project.card | listStyleType | none | disc |
| shell.header | count, size | 1, 351.2x64 | 2, 375x48 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.header | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(81, 156, 237) | rgb(230, 232, 226) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingBottom | 16px | 0px |
| shell.header | paddingLeft | 0px | 56px |
| shell.header | rowGap | 16px | 2px |
| shell.header | columnGap | 16px | 2px |
| shell.main | count, size | 1, 375.2x812 | 1, 375x812 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.main | backgroundColor | hsl(none 0% 9.80392%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderRightColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderBottomColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | borderLeftColor | rgba(255, 255, 255, 0.04) | rgb(230, 232, 226) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(255, 255, 255, 0.93) | rgb(230, 232, 226) |
| shell.sidebar | presence | 1 | absent |
| sidebar.section | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | anthropic-sans x14<br>Anthropicons-Variable x10<br>anthropic-serif x1 | instrumentSans x13<br>sourceSerif4 x1 |
| fontSize (4 vs 4) | 20px x10<br>14px x7<br>13px x7<br>24px x1 | 13px x7<br>14px x5<br>26px x1<br>15px x1 |
| fontWeight (4 vs 3) | 433.25 x10<br>400 x10<br>435 x4<br>500 x1 | 450 x7<br>600 x4<br>500 x3 |
| lineHeight (4 vs 5) | 20px x14<br>17px x7<br>21px x3<br>32px x1 | 18px x7<br>20px x4<br>32px x1<br>21px x1<br>22.5px x1 |
| letterSpacing (1 vs 2) | normal x25 | normal x13<br>-0.26px x1 |
| color (6 vs 4) | rgba(255, 255, 255, 0.93) x14<br>rgba(255, 255, 255, 0.57) x7<br>rgb(25, 25, 25) x1<br>rgb(51, 185, 59) x1<br>rgb(210, 142, 5) x1<br>rgb(244, 114, 48) x1 | rgb(230, 232, 226) x5<br>rgb(180, 186, 179) x4<br>rgb(163, 170, 164) x3<br>rgb(22, 26, 23) x2 |
| backgroundColor (7 vs 8) | rgb(25, 25, 25) x1<br>hsl(none 0% 9.80392%) x1<br>rgb(239, 239, 239) x1<br>color(srgb 0.0980392 0.0980392 0.0980392 / 0.85) x1<br>oklab(0.689759 -0.162042 0.118793 / 0.1) x1<br>oklab(0.697681 0.0384636 0.141262 / 0.1) x1<br>oklab(0.697647 0.126706 0.123785 / 0.1) x1 | rgb(34, 39, 35) x3<br>rgb(230, 232, 226) x2<br>rgb(20, 23, 21) x1<br>rgb(27, 31, 28) x1<br>rgb(93, 101, 95) x1<br>rgb(235, 181, 80) x1<br>oklab(0.544174 -0.0107603 0.00631091 / 0.3) x1<br>rgb(42, 48, 43) x1 |
| borderTopLeftRadius (3 vs 3) | 8px x16<br>7px x12<br>12px x9 | 8px x9<br>3.35544e+07px x3<br>14px x3 |
| boxShadow (0 vs 3) |  | rgb(53, 59, 54) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.35) 0px 1px 2px 0px, rgba(0, 0, 0, 0.3) 0px  x1<br>rgba(0, 0, 0, 0.2) 0px 4px 20px 0px, color(srgb 0.901961 0.9 x1 |
| borderTopColor (0 vs 2) |  | rgba(0, 0, 0, 0) x8<br>rgb(107, 114, 108) x1 |
| borderTopWidth (0 vs 1) |  | 1px x9 |
| paddingTop (2 vs 4) | 16px x3<br>4px x1 | 2px x3<br>48.72px x1<br>6px x1<br>12px x1 |
| paddingLeft (4 vs 8) | 12px x3<br>16px x3<br>42px x1<br>8px x1 | 2px x3<br>10px x2<br>9px x2<br>56px x1<br>16px x1<br>4px x1<br>12px x1<br>14px x1 |
| rowGap (6 vs 5) | 6px x14<br>4px x11<br>12px x10<br>8px x4<br>2px x3<br>16px x1 | 6px x4<br>2px x3<br>8px x3<br>4px x2<br>12px x1 |
| columnGap (6 vs 6) | 6px x14<br>4px x11<br>12px x10<br>8px x4<br>2px x3<br>16px x1 | 6px x4<br>2px x3<br>8px x2<br>4px x2<br>12px x1<br>10px x1 |
| transitionDuration (4 vs 1) | 0.06s x19<br>0.45s x14<br>0.5s x1<br>0.12s x1 | 0.15s x2 |
| transitionTimingFunction (4 vs 1) | linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x14<br>cubic-bezier(0.4, 0, 0.2, 1) x12<br>cubic-bezier(0.165, 0.84, 0.44, 1) x8<br>ease-out x1 | cubic-bezier(0.4, 0, 0.2, 1) x2 |
| animationName (1 vs 0) | task-grid-fade-in, task-grid-clip-reveal x1 |  |
| strokeWidth (0 vs 2) |  | 1.75px x7<br>1px x1 |

root custom properties: claude.ai 1386, cairn 72
