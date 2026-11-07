# Style diff: claude.ai vs cairn

Reference run: `/home/ian/.cache/cairn-design-capture/final/claude-ai-1440-light`
Ours run: `/home/ian/.cache/cairn-design-capture/final/cairn-1440-light`

## shell / initial

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 618 vs 200

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 28x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.36) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgba(0, 0, 0, 0.9) | rgb(63, 108, 53) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | count, size | 1, 1x1 | 1, 728x32 |
| home.greeting | position | absolute | static |
| home.greeting | fontFamily | anthropic-sans | sourceSerif4 |
| home.greeting | fontSize | 14px | 26px |
| home.greeting | fontWeight | 400 | 600 |
| home.greeting | lineHeight | 21px | 32px |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| home.greeting | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| home.greeting | marginTop | -1px | 0px |
| home.greeting | marginRight | -1px | 0px |
| home.greeting | marginBottom | -1px | 0px |
| home.greeting | marginLeft | -1px | 0px |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 1152x45 | 1, 1184x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 19, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (3 vs 3) | anthropic-sans x53<br>Anthropicons-Variable x42<br>anthropic-serif x2 | instrumentSans x51<br>jetbrainsMono x2<br>sourceSerif4 x1 |
| fontSize (7 vs 7) | 20px x37<br>14px x37<br>12px x14<br>16px x4<br>13px x3<br>32px x1<br>15px x1 | 14px x29<br>12px x10<br>13px x10<br>15px x2<br>20px x1<br>26px x1<br>17px x1 |
| fontWeight (8 vs 5) | 433.25 x36<br>435 x27<br>400 x24<br>533.25 x4<br>520 x2<br>577.75 x2<br>500 x1<br>360 x1 | 450 x33<br>500 x10<br>600 x7<br>700 x3<br>650 x1 |
| lineHeight (6 vs 10) | 20px x50<br>21px x27<br>12px x10<br>16px x7<br>18px x2<br>38.4px x1 | 24px x23<br>16px x8<br>18px x8<br>20px x7<br>22.5px x2<br>16.8px x2<br>26px x1<br>32px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 2) | normal x97 | normal x53<br>-0.26px x1 |
| color (6 vs 6) | rgba(0, 0, 0, 0.9) x70<br>rgba(0, 0, 0, 0.6) x21<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1 | rgb(29, 35, 31) x31<br>rgb(95, 102, 95) x13<br>rgb(75, 83, 77) x7<br>rgb(255, 255, 255) x1<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (10 vs 12) | rgb(255, 255, 255) x13<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgb(249, 249, 249) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1 | rgb(253, 253, 251) x5<br>rgb(236, 238, 232) x4<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(95, 102, 95) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(35, 49, 39) x1 |
| borderTopLeftRadius (7 vs 5) | 8px x91<br>6px x65<br>7px x19<br>11px x12<br>5px x2<br>2.68435e+07px x2<br>14px x1 | 8px x19<br>3.35544e+07px x8<br>14px x3<br>4px x3<br>12px x2 |
| boxShadow (5 vs 3) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (1 vs 2) | hsl(none 0% 4.31373% / 0.2) x4 | rgba(0, 0, 0, 0) x9<br>rgb(220, 223, 215) x2 |
| borderTopWidth (1 vs 1) | 0.8px x4 | 1px x11 |
| paddingTop (8 vs 8) | 8px x10<br>4px x8<br>3.5px x3<br>14px x3<br>16px x2<br>1px x1<br>297.1px x1<br>12px x1 | 8px x3<br>1px x3<br>2px x3<br>12px x2<br>4px x1<br>14px x1<br>24px x1<br>6px x1 |
| paddingLeft (11 vs 10) | 8px x29<br>2px x23<br>4px x8<br>10px x7<br>14px x3<br>1px x2<br>12px x2<br>296px x1<br>56px x1<br>6px x1<br>9px x1 | 8px x5<br>10px x5<br>12px x4<br>6px x3<br>4px x3<br>2px x3<br>9px x2<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x8<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x16<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x2 |
| columnGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x6<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x15<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x3 |
| transitionDuration (8 vs 1) | 0.06s x77<br>0.45s x39<br>0.2s x16<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x10 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x50<br>cubic-bezier(0.165, 0.84, 0.44, 1) x49<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x39<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (2 vs 1) | static-composer-actions-fade-in x7<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x18<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## shell / hover-sidebar-rows

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 624 vs 200

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 28x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.36) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgba(0, 0, 0, 0.9) | rgb(63, 108, 53) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | count, size | 1, 1x1 | 1, 728x32 |
| home.greeting | position | absolute | static |
| home.greeting | fontFamily | anthropic-sans | sourceSerif4 |
| home.greeting | fontSize | 14px | 26px |
| home.greeting | fontWeight | 400 | 600 |
| home.greeting | lineHeight | 21px | 32px |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| home.greeting | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| home.greeting | marginTop | -1px | 0px |
| home.greeting | marginRight | -1px | 0px |
| home.greeting | marginBottom | -1px | 0px |
| home.greeting | marginLeft | -1px | 0px |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 1152x45 | 1, 1184x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 20, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (3 vs 3) | anthropic-sans x53<br>Anthropicons-Variable x43<br>anthropic-serif x2 | instrumentSans x51<br>jetbrainsMono x2<br>sourceSerif4 x1 |
| fontSize (7 vs 7) | 20px x38<br>14px x37<br>12px x14<br>16px x4<br>13px x3<br>32px x1<br>15px x1 | 14px x29<br>12px x10<br>13px x10<br>15px x2<br>20px x1<br>26px x1<br>17px x1 |
| fontWeight (8 vs 5) | 433.25 x37<br>435 x27<br>400 x24<br>533.25 x4<br>520 x2<br>577.75 x2<br>500 x1<br>360 x1 | 450 x33<br>500 x10<br>600 x7<br>700 x3<br>650 x1 |
| lineHeight (6 vs 10) | 20px x51<br>21px x27<br>12px x10<br>16px x7<br>18px x2<br>38.4px x1 | 24px x23<br>16px x8<br>18px x8<br>20px x7<br>22.5px x2<br>16.8px x2<br>26px x1<br>32px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 2) | normal x98 | normal x53<br>-0.26px x1 |
| color (6 vs 6) | rgba(0, 0, 0, 0.9) x71<br>rgba(0, 0, 0, 0.6) x21<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1 | rgb(29, 35, 31) x31<br>rgb(95, 102, 95) x13<br>rgb(75, 83, 77) x7<br>rgb(255, 255, 255) x1<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (10 vs 12) | rgb(255, 255, 255) x13<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgb(249, 249, 249) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1 | rgb(253, 253, 251) x5<br>rgb(236, 238, 232) x4<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(95, 102, 95) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(35, 49, 39) x1 |
| borderTopLeftRadius (7 vs 5) | 8px x91<br>6px x68<br>7px x19<br>11px x12<br>5px x2<br>2.68435e+07px x2<br>14px x1 | 8px x19<br>3.35544e+07px x8<br>14px x3<br>4px x3<br>12px x2 |
| boxShadow (5 vs 3) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (1 vs 2) | hsl(none 0% 4.31373% / 0.2) x4 | rgba(0, 0, 0, 0) x9<br>rgb(220, 223, 215) x2 |
| borderTopWidth (1 vs 1) | 0.8px x4 | 1px x11 |
| paddingTop (8 vs 8) | 8px x10<br>4px x8<br>3.5px x3<br>14px x3<br>16px x2<br>1px x1<br>297.1px x1<br>12px x1 | 8px x3<br>1px x3<br>2px x3<br>12px x2<br>4px x1<br>14px x1<br>24px x1<br>6px x1 |
| paddingLeft (11 vs 10) | 8px x29<br>2px x23<br>4px x8<br>10px x7<br>14px x3<br>1px x2<br>12px x2<br>296px x1<br>56px x1<br>6px x1<br>9px x1 | 8px x5<br>10px x5<br>12px x4<br>6px x3<br>4px x3<br>2px x3<br>9px x2<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (9 vs 6) | 4px x66<br>6px x42<br>2px x23<br>8px x8<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x16<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x2 |
| columnGap (9 vs 6) | 4px x66<br>6px x42<br>2px x23<br>8px x6<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x15<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x3 |
| transitionDuration (8 vs 1) | 0.06s x79<br>0.45s x40<br>0.2s x16<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x10 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x51<br>cubic-bezier(0.165, 0.84, 0.44, 1) x50<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x40<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (2 vs 1) | static-composer-actions-fade-in x7<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x18<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## shell / press-composer-plus

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 688 vs 201

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 28x28 | 2, 72.8x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 2, 704x70 |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgba(0, 0, 0, 0) |
| composer.box | borderTopWidth | 0px | 1px |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(63, 108, 53) |
| composer.box | borderRightWidth | 0px | 1px |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(63, 108, 53) |
| composer.box | borderBottomWidth | 0px | 1px |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(63, 108, 53) |
| composer.box | borderLeftWidth | 0px | 1px |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(63, 108, 53) |
| composer.box | borderTopLeftRadius | 14px | 8px |
| composer.box | borderTopRightRadius | 14px | 8px |
| composer.box | borderBottomRightRadius | 14px | 8px |
| composer.box | borderBottomLeftRadius | 14px | 8px |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | oklab(0.484428 -0.0745587 0.0625856 / 0.5) 0px 0px 0px 3px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| composer.box | paddingTop | 8px | 0px |
| composer.box | paddingRight | 8px | 0px |
| composer.box | paddingBottom | 8px | 0px |
| composer.box | paddingLeft | 8px | 0px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.box | transitionDuration | 0.2s | 0.15s |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 28x28 | 6, 72.8x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 2, 702x36 |
| composer.input | display | block | flex |
| composer.input | position | relative | static |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 15px | 14px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 20px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 8px |
| composer.input | paddingRight | 0px | 10px |
| composer.input | paddingBottom | 0px | 8px |
| composer.input | paddingLeft | 0px | 10px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| menu | presence | 1 | absent |
| menu.item | presence | 8 | absent |
| menu.separator | presence | 2 | absent |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 1152x45 | 1, 1184x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 20, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (3 vs 2) | anthropic-sans x64<br>Anthropicons-Variable x57<br>anthropic-serif x2 | instrumentSans x50<br>jetbrainsMono x2 |
| fontSize (7 vs 6) | 20px x47<br>14px x45<br>12px x14<br>16px x9<br>13px x6<br>32px x1<br>15px x1 | 14px x29<br>12px x10<br>13px x9<br>15px x2<br>20px x1<br>17px x1 |
| fontWeight (9 vs 5) | 433.25 x45<br>435 x38<br>400 x24<br>533.25 x9<br>520 x2<br>577.75 x2<br>500 x1<br>360 x1<br>566.5 x1 | 450 x32<br>500 x10<br>600 x6<br>700 x3<br>650 x1 |
| lineHeight (7 vs 9) | 20px x68<br>21px x27<br>16px x12<br>12px x10<br>17px x3<br>18px x2<br>38.4px x1 | 24px x23<br>16px x8<br>20px x7<br>18px x7<br>22.5px x2<br>16.8px x2<br>26px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x123 | normal x52 |
| color (7 vs 6) | rgba(0, 0, 0, 0.9) x87<br>rgba(0, 0, 0, 0.6) x29<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgb(37, 125, 224) x1 | rgb(29, 35, 31) x30<br>rgb(95, 102, 95) x12<br>rgb(75, 83, 77) x7<br>rgb(255, 255, 255) x1<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (10 vs 12) | rgb(255, 255, 255) x14<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgba(0, 0, 0, 0.1) x4<br>rgb(249, 249, 249) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1 | rgb(253, 253, 251) x5<br>rgb(236, 238, 232) x5<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(95, 102, 95) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(35, 49, 39) x1 |
| borderTopLeftRadius (7 vs 6) | 8px x99<br>6px x68<br>7px x19<br>11px x12<br>14px x3<br>5px x2<br>2.68435e+07px x2 | 8px x20<br>3.35544e+07px x8<br>14px x3<br>4px x3<br>12px x2<br>5px x1 |
| boxShadow (6 vs 4) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x1<br>rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.0 x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>oklab(0.484428 -0.0745587 0.0625856 / 0.5) 0px 0px 0px 3px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (1 vs 3) | hsl(none 0% 4.31373% / 0.2) x4 | rgba(0, 0, 0, 0) x10<br>rgb(220, 223, 215) x2<br>rgb(63, 108, 53) x1 |
| borderTopWidth (1 vs 1) | 0.8px x4 | 1px x13 |
| paddingTop (9 vs 7) | 4px x16<br>8px x10<br>3.5px x3<br>14px x3<br>16px x2<br>1px x1<br>297.1px x1<br>12px x1<br>6px x1 | 8px x4<br>1px x3<br>2px x3<br>12px x2<br>4px x1<br>14px x1<br>6px x1 |
| paddingLeft (11 vs 10) | 8px x29<br>2px x23<br>10px x15<br>4px x8<br>14px x3<br>1px x2<br>6px x2<br>12px x2<br>296px x1<br>56px x1<br>9px x1 | 10px x7<br>8px x5<br>12px x4<br>6px x3<br>4px x3<br>2px x3<br>9px x2<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (10 vs 6) | 4px x66<br>6px x42<br>2px x23<br>8px x19<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1<br>1.95px x1 | 8px x17<br>6px x8<br>2px x6<br>4px x6<br>1px x5<br>10px x2 |
| columnGap (10 vs 6) | 4px x66<br>6px x42<br>2px x23<br>8px x17<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1<br>1.95px x1 | 8px x16<br>6px x8<br>2px x6<br>4px x6<br>1px x5<br>10px x3 |
| transitionDuration (8 vs 1) | 0.06s x79<br>0.45s x40<br>0.2s x16<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x12 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x51<br>cubic-bezier(0.165, 0.84, 0.44, 1) x50<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x40<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x12 |
| animationName (4 vs 1) | static-composer-actions-fade-in x7<br>task-grid-fade-in, task-grid-clip-reveal x1<br>cds-fade-in x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x19<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## shell / type-composer

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 533 vs 201

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 28x28 | 2, 72.8x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 2, 704x70 |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgba(0, 0, 0, 0) |
| composer.box | borderTopWidth | 0px | 1px |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(63, 108, 53) |
| composer.box | borderRightWidth | 0px | 1px |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(63, 108, 53) |
| composer.box | borderBottomWidth | 0px | 1px |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(63, 108, 53) |
| composer.box | borderLeftWidth | 0px | 1px |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(63, 108, 53) |
| composer.box | borderTopLeftRadius | 14px | 8px |
| composer.box | borderTopRightRadius | 14px | 8px |
| composer.box | borderBottomRightRadius | 14px | 8px |
| composer.box | borderBottomLeftRadius | 14px | 8px |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | oklab(0.484428 -0.0745587 0.0625856 / 0.5) 0px 0px 0px 3px |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| composer.box | paddingTop | 8px | 0px |
| composer.box | paddingRight | 8px | 0px |
| composer.box | paddingBottom | 8px | 0px |
| composer.box | paddingLeft | 8px | 0px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.box | transitionDuration | 0.2s | 0.15s |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 28x28 | 6, 72.8x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 2, 702x36 |
| composer.input | display | block | flex |
| composer.input | position | relative | static |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 15px | 14px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 20px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 8px |
| composer.input | paddingRight | 0px | 10px |
| composer.input | paddingBottom | 0px | 8px |
| composer.input | paddingLeft | 0px | 10px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
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
| shell.header | count, size | 1, 1152x45 | 1, 1184x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 20, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (3 vs 2) | anthropic-sans x44<br>Anthropicons-Variable x39<br>anthropic-serif x2 | instrumentSans x51<br>jetbrainsMono x2 |
| fontSize (6 vs 6) | 20px x37<br>14px x31<br>12px x14<br>32px x1<br>15px x1<br>16px x1 | 14px x30<br>12px x10<br>13px x9<br>15px x2<br>20px x1<br>17px x1 |
| fontWeight (8 vs 5) | 433.25 x36<br>435 x25<br>400 x17<br>520 x2<br>577.75 x2<br>500 x1<br>360 x1<br>533.25 x1 | 450 x33<br>500 x10<br>600 x6<br>700 x3<br>650 x1 |
| lineHeight (6 vs 9) | 20px x45<br>21px x26<br>12px x10<br>18px x2<br>38.4px x1<br>16px x1 | 24px x23<br>16px x8<br>20px x8<br>18px x7<br>22.5px x2<br>16.8px x2<br>26px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x85 | normal x53 |
| color (4 vs 6) | rgba(0, 0, 0, 0.9) x65<br>rgba(0, 0, 0, 0.6) x18<br>rgb(16, 161, 34) x1<br>rgb(255, 255, 255) x1 | rgb(29, 35, 31) x31<br>rgb(95, 102, 95) x12<br>rgb(75, 83, 77) x7<br>rgb(255, 255, 255) x1<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (8 vs 12) | rgb(255, 255, 255) x3<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>hsl(none 0% 4.31373% / 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgb(198, 97, 63) x1 | rgb(253, 253, 251) x5<br>rgb(236, 238, 232) x4<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(95, 102, 95) x2<br>rgb(35, 49, 39) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1 |
| borderTopLeftRadius (6 vs 6) | 8px x83<br>6px x59<br>7px x5<br>5px x2<br>2.68435e+07px x2<br>14px x1 | 8px x20<br>3.35544e+07px x8<br>14px x3<br>4px x3<br>12px x2<br>5px x1 |
| boxShadow (2 vs 4) | hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>oklab(0.484428 -0.0745587 0.0625856 / 0.5) 0px 0px 0px 3px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (0 vs 3) |  | rgba(0, 0, 0, 0) x10<br>rgb(220, 223, 215) x2<br>rgb(63, 108, 53) x1 |
| borderTopWidth (0 vs 1) |  | 1px x13 |
| paddingTop (6 vs 7) | 8px x6<br>4px x5<br>16px x2<br>3.5px x2<br>1px x1<br>297.1px x1 | 8px x4<br>1px x3<br>2px x3<br>12px x2<br>4px x1<br>14px x1<br>6px x1 |
| paddingLeft (8 vs 10) | 8px x25<br>2px x23<br>10px x7<br>4px x4<br>1px x2<br>296px x1<br>56px x1<br>6px x1 | 10px x7<br>8px x5<br>12px x4<br>6px x3<br>4px x3<br>2px x3<br>9px x2<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (8 vs 6) | 4px x62<br>6px x37<br>2px x23<br>8px x8<br>1.8px x2<br>5px x2<br>24px x1<br>28px x1 | 8px x17<br>6px x8<br>2px x6<br>4px x6<br>1px x5<br>10px x2 |
| columnGap (8 vs 6) | 4px x62<br>6px x37<br>2px x23<br>8px x6<br>1.8px x2<br>5px x2<br>24px x1<br>28px x1 | 8px x16<br>6px x8<br>2px x6<br>4px x6<br>1px x5<br>10px x3 |
| transitionDuration (8 vs 1) | 0.06s x70<br>0.45s x30<br>0.2s x5<br>0.12s x3<br>0.28s x2<br>0.5s x1<br>0.15s x1<br>0.12s, 0s x1 | 0.15s x12 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x44<br>cubic-bezier(0.165, 0.84, 0.44, 1) x36<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x30<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x12 |
| animationName (1 vs 1) | task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x19<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## shell / open-model-menu

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 674 vs 227

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 28x28 | 2, 72.8x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 2, 704x70 |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgba(0, 0, 0, 0) |
| composer.box | borderTopWidth | 0px | 1px |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.box | borderRightWidth | 0px | 1px |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.box | borderBottomWidth | 0px | 1px |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.box | borderLeftWidth | 0px | 1px |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.box | borderTopLeftRadius | 14px | 8px |
| composer.box | borderTopRightRadius | 14px | 8px |
| composer.box | borderBottomRightRadius | 14px | 8px |
| composer.box | borderBottomLeftRadius | 14px | 8px |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | none |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| composer.box | paddingTop | 8px | 0px |
| composer.box | paddingRight | 8px | 0px |
| composer.box | paddingBottom | 8px | 0px |
| composer.box | paddingLeft | 8px | 0px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.box | transitionDuration | 0.2s | 0.15s |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 28x28 | 6, 72.8x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 2, 702x36 |
| composer.input | display | block | flex |
| composer.input | position | relative | static |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 15px | 14px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 20px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| composer.input | paddingTop | 0px | 8px |
| composer.input | paddingRight | 0px | 10px |
| composer.input | paddingBottom | 0px | 8px |
| composer.input | paddingLeft | 0px | 10px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.model | backgroundColor | rgba(0, 0, 0, 0) | rgb(236, 238, 232) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| menu | count, size | 1, 305.4x270 | 1, 320x180 |
| menu | display | flex | block |
| menu | position | relative | static |
| menu | fontFamily | anthropic-sans | instrumentSans |
| menu | fontWeight | 400 | 450 |
| menu | lineHeight | 20px | 21px |
| menu | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| menu | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| menu | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| menu | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| menu | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| menu | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| menu | borderTopLeftRadius | 14px | 12px |
| menu | borderTopRightRadius | 14px | 12px |
| menu | borderBottomRightRadius | 14px | 12px |
| menu | borderBottomLeftRadius | 14px | 12px |
| menu | boxShadow | rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.08) 0px 0px 0px 1px, rgba(0, 0, | rgba(29, 35, 31, 0.08) 0px 2px 6px 0px, rgba(29, 35, 31, 0.12) 0px 8px 24px 0px, rgb(220,  |
| menu | outlineWidth | 2.4px | 3px |
| menu | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| menu | paddingTop | 0px | 4px |
| menu | paddingRight | 0px | 4px |
| menu | paddingBottom | 0px | 4px |
| menu | paddingLeft | 0px | 4px |
| menu | maxWidth | 416px | 320px |
| menu | transitionDuration | 0s | 0.1s |
| menu | animationName | none | enter |
| menu | animationDuration | 0s | 0.1s |
| menu.item | count, size | 6, 293.4x46 | 3, 312x48 |
| menu.item | position | static | relative |
| menu.item | fontFamily | anthropic-sans | instrumentSans |
| menu.item | fontWeight | 435 | 450 |
| menu.item | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| menu.item | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| menu.item | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| menu.item | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| menu.item | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| menu.item | outlineWidth | 2.4px | 3px |
| menu.item | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| menu.item | paddingTop | 4px | 6px |
| menu.item | paddingRight | 10px | 32px |
| menu.item | paddingBottom | 5px | 6px |
| menu.item | rowGap | 8px | 10px |
| menu.item | columnGap | 8px | 10px |
| menu.item | cursor | pointer | default |
| menu.separator | presence | 2 | absent |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 1152x45 | 1, 1184x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 20, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (3 vs 2) | anthropic-sans x64<br>Anthropicons-Variable x46<br>anthropic-serif x2 | instrumentSans x57<br>jetbrainsMono x2 |
| fontSize (7 vs 6) | 14px x43<br>20px x39<br>12px x14<br>13px x8<br>16px x6<br>32px x1<br>15px x1 | 14px x32<br>12px x14<br>13px x9<br>15px x2<br>20px x1<br>17px x1 |
| fontWeight (9 vs 5) | 435 x38<br>433.25 x37<br>400 x24<br>533.25 x6<br>520 x2<br>577.75 x2<br>500 x1<br>360 x1<br>566.5 x1 | 450 x35<br>500 x14<br>600 x6<br>700 x3<br>650 x1 |
| lineHeight (7 vs 9) | 20px x58<br>21px x27<br>12px x10<br>16px x9<br>17px x5<br>18px x2<br>38.4px x1 | 24px x23<br>16px x12<br>20px x10<br>18px x7<br>22.5px x2<br>16.8px x2<br>26px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x112 | normal x59 |
| color (7 vs 6) | rgba(0, 0, 0, 0.9) x77<br>rgba(0, 0, 0, 0.6) x28<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgb(37, 125, 224) x1 | rgb(29, 35, 31) x33<br>rgb(95, 102, 95) x16<br>rgb(75, 83, 77) x7<br>rgb(255, 255, 255) x1<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (10 vs 12) | rgb(255, 255, 255) x14<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgba(0, 0, 0, 0.1) x4<br>rgb(249, 249, 249) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1 | rgb(253, 253, 251) x6<br>rgb(236, 238, 232) x6<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(95, 102, 95) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(35, 49, 39) x1 |
| borderTopLeftRadius (7 vs 6) | 8px x97<br>6px x68<br>7px x19<br>11px x12<br>14px x3<br>5px x2<br>2.68435e+07px x2 | 8px x23<br>3.35544e+07px x8<br>14px x3<br>12px x3<br>4px x3<br>5px x1 |
| boxShadow (6 vs 4) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x1<br>rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.0 x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1<br>rgba(29, 35, 31, 0.08) 0px 2px 6px 0px, rgba(29, 35, 31, 0.1 x1 |
| borderTopColor (1 vs 3) | hsl(none 0% 4.31373% / 0.2) x4 | rgba(0, 0, 0, 0) x10<br>rgb(220, 223, 215) x2<br>rgb(204, 208, 199) x1 |
| borderTopWidth (1 vs 1) | 0.8px x4 | 1px x13 |
| paddingTop (10 vs 7) | 4px x14<br>8px x10<br>3.5px x3<br>14px x3<br>16px x2<br>1px x1<br>297.1px x1<br>12px x1<br>6px x1<br>1.625px x1 | 8px x5<br>6px x4<br>1px x3<br>2px x3<br>4px x2<br>12px x2<br>14px x1 |
| paddingLeft (11 vs 10) | 8px x29<br>2px x23<br>10px x13<br>4px x8<br>14px x3<br>1px x2<br>6px x2<br>12px x2<br>296px x1<br>56px x1<br>9px x1 | 10px x11<br>8px x5<br>12px x4<br>4px x4<br>6px x3<br>2px x3<br>9px x2<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (9 vs 6) | 4px x66<br>6px x42<br>8px x23<br>2px x23<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x17<br>6px x8<br>2px x6<br>4px x6<br>1px x5<br>10px x5 |
| columnGap (9 vs 6) | 4px x66<br>6px x42<br>2px x23<br>8px x21<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x16<br>6px x8<br>2px x6<br>10px x6<br>4px x6<br>1px x5 |
| transitionDuration (8 vs 2) | 0.06s x79<br>0.45s x40<br>0.2s x16<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x12<br>0.1s x1 |
| transitionTimingFunction (6 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x51<br>cubic-bezier(0.165, 0.84, 0.44, 1) x50<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x40<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x12<br>ease x1 |
| animationName (3 vs 2) | task-grid-fade-in, task-grid-clip-reveal x1<br>fade-in x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1 | live-pulse x1<br>enter x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x20<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## shell / collapse-sidebar

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 624 vs 171

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 28x28 | 2, 72.8x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 2, 704x70 |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgba(0, 0, 0, 0) |
| composer.box | borderTopWidth | 0px | 1px |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.box | borderRightWidth | 0px | 1px |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.box | borderBottomWidth | 0px | 1px |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.box | borderLeftWidth | 0px | 1px |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.box | borderTopLeftRadius | 14px | 8px |
| composer.box | borderTopRightRadius | 14px | 8px |
| composer.box | borderBottomRightRadius | 14px | 8px |
| composer.box | borderBottomLeftRadius | 14px | 8px |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | none |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| composer.box | paddingTop | 8px | 0px |
| composer.box | paddingRight | 8px | 0px |
| composer.box | paddingBottom | 8px | 0px |
| composer.box | paddingLeft | 8px | 0px |
| composer.box | rowGap | 8px | normal |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.box | transitionDuration | 0.2s | 0.15s |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 28x28 | 6, 72.8x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 2, 702x36 |
| composer.input | display | block | flex |
| composer.input | position | relative | static |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontSize | 15px | 14px |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 20px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| composer.input | paddingTop | 0px | 8px |
| composer.input | paddingRight | 0px | 10px |
| composer.input | paddingBottom | 0px | 8px |
| composer.input | paddingLeft | 0px | 10px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
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
| shell.header | count, size | 1, 1440x45 | 1, 1392x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.header | transitionProperty | clip-path | all |
| shell.header | transitionTimingFunction | linear | ease |
| shell.main | count, size | 1, 1440x900 | 1, 1392x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 32x32 | 1, 40x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgba(0, 0, 0, 0) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0) | rgb(29, 35, 31) |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 8px |
| shell.sidebar | paddingBottom | 0px | 8px |
| shell.sidebar | rowGap | normal | 1px |
| shell.sidebar | columnGap | normal | 1px |
| shell.sidebar | transitionProperty | none | all |
| sidebar.footer | presence | 20 | absent |
| sidebar.navrow | presence | 5 | absent |
| sidebar.row | presence | 12 | absent |
| sidebar.row.fill | presence | 1 | absent |
| sidebar.section | presence | 22 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 2) | anthropic-sans x53<br>Anthropicons-Variable x43<br>anthropic-serif x2 | instrumentSans x40<br>jetbrainsMono x2 |
| fontSize (7 vs 5) | 20px x38<br>14px x37<br>12px x14<br>16px x4<br>13px x3<br>32px x1<br>15px x1 | 14px x27<br>13px x9<br>12px x3<br>15px x2<br>17px x1 |
| fontWeight (8 vs 4) | 433.25 x37<br>435 x27<br>400 x24<br>533.25 x4<br>520 x2<br>577.75 x2<br>500 x1<br>360 x1 | 450 x29<br>500 x6<br>600 x4<br>700 x3 |
| lineHeight (6 vs 8) | 20px x51<br>21px x27<br>12px x10<br>16px x7<br>18px x2<br>38.4px x1 | 24px x23<br>18px x7<br>20px x5<br>22.5px x2<br>16.8px x2<br>16px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x98 | normal x42 |
| color (6 vs 5) | rgba(0, 0, 0, 0.9) x71<br>rgba(0, 0, 0, 0.6) x21<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1 | rgb(29, 35, 31) x24<br>rgb(95, 102, 95) x9<br>rgb(75, 83, 77) x7<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (9 vs 11) | rgb(255, 255, 255) x14<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgba(0, 0, 0, 0.1) x2<br>rgb(249, 249, 249) x2<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1 | rgb(253, 253, 251) x5<br>rgb(236, 238, 232) x5<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.05) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(95, 102, 95) x1<br>rgb(35, 49, 39) x1 |
| borderTopLeftRadius (7 vs 6) | 8px x88<br>6px x68<br>7px x22<br>11px x12<br>5px x2<br>2.68435e+07px x2<br>14px x1 | 8px x16<br>3.35544e+07px x7<br>14px x3<br>4px x3<br>12px x2<br>5px x1 |
| boxShadow (6 vs 3) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>rgba(0, 0, 0, 0.06) 0px 0px 0px 0.5px, rgba(0, 0, 0, 0.06) 0 x1<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (1 vs 3) | hsl(none 0% 4.31373% / 0.2) x4 | rgba(0, 0, 0, 0) x7<br>rgb(220, 223, 215) x2<br>rgb(204, 208, 199) x1 |
| borderTopWidth (1 vs 1) | 0.8px x4 | 1px x10 |
| paddingTop (9 vs 7) | 8px x9<br>4px x7<br>3.5px x3<br>14px x3<br>16px x2<br>45px x1<br>1px x1<br>297.1px x1<br>12px x1 | 8px x4<br>1px x3<br>2px x3<br>4px x1<br>14px x1<br>6px x1<br>12px x1 |
| paddingLeft (10 vs 9) | 8px x29<br>2px x23<br>4px x8<br>10px x7<br>14px x3<br>1px x2<br>12px x2<br>56px x1<br>6px x1<br>9px x1 | 10px x4<br>12px x3<br>2px x3<br>4px x2<br>6px x2<br>9px x2<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (9 vs 5) | 4px x66<br>6px x42<br>2px x23<br>8px x8<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x15<br>6px x6<br>4px x5<br>2px x4<br>1px x2 |
| columnGap (9 vs 6) | 4px x66<br>6px x42<br>2px x23<br>8px x6<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x14<br>6px x6<br>4px x5<br>2px x4<br>1px x2<br>10px x1 |
| transitionDuration (8 vs 1) | 0.06s x80<br>0.45s x40<br>0.2s x16<br>0.15s x2<br>0.12s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x12 |
| transitionTimingFunction (5 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x52<br>cubic-bezier(0.165, 0.84, 0.44, 1) x50<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x40<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0, 0, 0.2, 1) x8<br>cubic-bezier(0.4, 0, 0.2, 1) x4 |
| animationName (3 vs 1) | task-grid-fade-in, task-grid-clip-reveal x1<br>cds-fade-in x1<br>fade-in x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x17<br>1px x2 |

root custom properties: claude.ai 1383, cairn 72

## shell / open-settings-dialog

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 812 vs 242

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | presence | 15 | absent |
| code.block | presence | absent | 1 |
| code.block.box | presence | absent | 1 |
| code.inline | presence | absent | 1 |
| composer.box | count, size | 1, 656x103 | 1, 139.2x34.4 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.22) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 2, 11.2x11.2 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.button | opacity | 1 | 0.5 |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | rowGap | 6px | normal |
| composer.button | columnGap | 6px | normal |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.input | count, size | 1, 632x50 | 1, 128x14.4 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | presence | 1 | absent |
| dialog | count, size | 1, 1024x800 | 3, 1216x852 |
| dialog | display | grid | flex |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 400 | 450 |
| dialog | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog | backgroundColor | rgb(255, 255, 255) | rgb(246, 246, 242) |
| dialog | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderTopLeftRadius | 12px | 14px |
| dialog | borderTopRightRadius | 12px | 14px |
| dialog | borderBottomRightRadius | 12px | 14px |
| dialog | borderBottomLeftRadius | 12px | 14px |
| dialog | boxShadow | rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.08) 0px 0px 0px 1px, hsl(none 0 | rgb(220, 223, 215) 0px 0px 0px 1px, rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29, 35,  |
| dialog | outlineWidth | 2.4px | 3px |
| dialog | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| dialog | marginTop | 50px | 0px |
| dialog | marginRight | 208px | 0px |
| dialog | marginBottom | 50px | 0px |
| dialog | marginLeft | 208px | 0px |
| dialog | maxWidth | 1024px | none |
| dialog | transitionProperty | opacity, scale | all |
| dialog | transitionDuration | 0.2s | 0s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | ease |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.4)","color":"rgba(0, 0, 0, 0.9)","radius":"12px"," | null |
| dialog.input | presence | 2 | absent |
| dialog.navitem | presence | 12 | absent |
| dialog.radiogroup | presence | 1 | absent |
| dialog.select | count, size | 8, 192.6x28 | 1, 89.8x32 |
| dialog.select | fontFamily | anthropic-sans | instrumentSans |
| dialog.select | fontWeight | 435 | 450 |
| dialog.select | whiteSpace | normal | nowrap |
| dialog.select | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.select | backgroundColor | rgba(0, 0, 0, 0) | rgb(253, 253, 251) |
| dialog.select | borderTopWidth | 0px | 1px |
| dialog.select | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderRightWidth | 0px | 1px |
| dialog.select | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderBottomWidth | 0px | 1px |
| dialog.select | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderLeftWidth | 0px | 1px |
| dialog.select | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderTopLeftRadius | 0px | 8px |
| dialog.select | borderTopRightRadius | 0px | 8px |
| dialog.select | borderBottomRightRadius | 0px | 8px |
| dialog.select | borderBottomLeftRadius | 0px | 8px |
| dialog.select | boxShadow | none | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px |
| dialog.select | outlineWidth | 1.6px | 3px |
| dialog.select | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| dialog.switch | presence | absent | 1 |
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
| shell.header | count, size | 1, 1152x45 | 1, 152x24.8 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingTop | 0px | 4px |
| shell.header | paddingRight | 0px | 16px |
| shell.header | paddingBottom | 0px | 12px |
| shell.header | paddingLeft | 0px | 16px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.main | presence | 1 | absent |
| shell.sidebar | count, size | 1, 288x900 | 1, 152x240 |
| shell.sidebar | position | absolute | fixed |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(253, 253, 251) |
| shell.sidebar | opacity | 1 | 0 |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderTopLeftRadius | 0px | 18px |
| shell.sidebar | borderTopRightRadius | 0px | 18px |
| shell.sidebar | borderBottomRightRadius | 0px | 18px |
| shell.sidebar | borderBottomLeftRadius | 0px | 18px |
| shell.sidebar | boxShadow | none | rgb(220, 223, 215) 0px 0px 0px 1px inset, rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29 |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | maxWidth | none | 1424px |
| shell.sidebar | transitionProperty | all | none |
| shell.sidebar | transitionDuration | 0s | 0.2s |
| shell.sidebar | transitionTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| shell.sidebar | animationName | none | exit |
| shell.sidebar | animationDuration | 0s | 0.2s |
| shell.sidebar | animationTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| sidebar.footer | presence | 20 | absent |
| sidebar.navrow | presence | 5 | absent |
| sidebar.row | presence | 12 | absent |
| sidebar.row.fill | presence | 1 | absent |
| sidebar.section | presence | 21 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 3) | anthropic-sans x89<br>Anthropicons-Variable x68<br>anthropic-serif x3<br>anthropic-sans-display x1 | instrumentSans x58<br>jetbrainsMono x2<br>sourceSerif4 x1 |
| fontSize (8 vs 6) | 14px x70<br>20px x54<br>12px x14<br>16px x13<br>15px x4<br>13px x4<br>32px x1<br>22px x1 | 14px x40<br>13px x9<br>12px x7<br>17px x2<br>15px x2<br>20px x1 |
| fontWeight (8 vs 5) | 433.25 x53<br>435 x46<br>400 x39<br>533.25 x13<br>520 x6<br>577.75 x2<br>500 x1<br>360 x1 | 450 x46<br>500 x9<br>700 x3<br>600 x2<br>650 x1 |
| lineHeight (8 vs 8) | 20px x103<br>21px x27<br>16px x16<br>12px x10<br>18px x2<br>38.4px x1<br>28px x1<br>17px x1 | 24px x24<br>20px x19<br>18px x7<br>16px x5<br>22.5px x2<br>16.8px x2<br>26px x1<br>12px x1 |
| letterSpacing (1 vs 1) | normal x161 | normal x61 |
| color (6 vs 4) | rgba(0, 0, 0, 0.9) x121<br>rgba(0, 0, 0, 0.6) x34<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1 | rgb(29, 35, 31) x28<br>rgb(95, 102, 95) x17<br>rgb(75, 83, 77) x15<br>rgb(110, 73, 0) x1 |
| backgroundColor (13 vs 11) | rgb(255, 255, 255) x18<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgba(255, 255, 255, 0.5) x5<br>hsl(none 0% 4.31373% / 0.05) x2<br>rgba(0, 0, 0, 0.1) x2<br>rgb(249, 249, 249) x2<br>rgb(250, 250, 250) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgb(25, 25, 25) x1 | rgb(253, 253, 251) x8<br>rgb(236, 238, 232) x4<br>rgb(230, 231, 225) x2<br>rgba(0, 0, 0, 0.6) x1<br>rgb(246, 246, 242) x1<br>rgb(210, 214, 204) x1<br>rgb(85, 131, 63) x1<br>rgb(255, 255, 255) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(95, 102, 95) x1 |
| borderTopLeftRadius (8 vs 7) | 8px x120<br>6px x71<br>7px x20<br>11px x12<br>5px x2<br>2.68435e+07px x2<br>14px x1<br>12px x1 | 8px x19<br>3.35544e+07px x8<br>14px x3<br>4px x3<br>12px x2<br>6px x1<br>18px x1 |
| boxShadow (7 vs 9) | rgba(0, 0, 0, 0.08) 0px 0px 0px 1px inset x5<br>hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x1<br>rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.0 x1 | oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgb(220, 223, 215) 0px 0px 0px 1px, rgba(29, 35, 31, 0.08) 0 x1<br>rgb(220, 223, 215) 0px 0px 0px 1px inset x1<br>oklab(0.2486 -0.0105006 0.00462133 / 0.08) 0px 0px 0px 1px x1<br>rgb(220, 223, 215) 0px 0px 0px 1px x1<br>rgba(29, 35, 31, 0.06) 0px 1px 2px 0px x1<br>rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x1<br>rgb(220, 223, 215) 0px 0px 0px 1px inset, rgba(29, 35, 31, 0 x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (4 vs 3) | hsl(none 0% 4.31373% / 0.05) x7<br>hsl(none 0% 4.31373% / 0.2) x4<br>hsl(none 0% 4.31373% / 0.1) x2<br>rgba(0, 0, 0, 0.08) x2 | rgba(0, 0, 0, 0) x2<br>rgb(220, 223, 215) x2<br>rgb(204, 208, 199) x1 |
| borderTopWidth (1 vs 1) | 0.8px x15 | 1px x5 |
| paddingTop (8 vs 8) | 8px x11<br>12px x11<br>4px x8<br>16px x4<br>3.5px x3<br>14px x3<br>1px x2<br>297.1px x1 | 4px x5<br>8px x3<br>1px x3<br>2px x3<br>12px x2<br>16px x2<br>6px x2<br>14px x1 |
| paddingLeft (12 vs 8) | 8px x50<br>2px x23<br>4px x8<br>10px x7<br>12px x4<br>16px x4<br>1px x3<br>14px x3<br>296px x1<br>56px x1<br>6px x1<br>9px x1 | 10px x18<br>16px x7<br>2px x4<br>12px x3<br>6px x3<br>4px x3<br>8px x1<br>14px x1 |
| rowGap (11 vs 9) | 4px x77<br>6px x62<br>2px x23<br>12px x17<br>28px x11<br>8px x8<br>5px x3<br>1px x3<br>1.8px x2<br>16px x2<br>24px x1 | 8px x13<br>10px x13<br>4px x6<br>12px x4<br>16px x4<br>1px x4<br>2px x4<br>6px x3<br>24px x1 |
| columnGap (10 vs 9) | 4px x77<br>6px x62<br>2px x23<br>12px x17<br>28px x11<br>8px x6<br>5px x3<br>1.8px x2<br>16px x2<br>24px x1 | 8px x13<br>10px x13<br>4px x6<br>12px x4<br>16px x4<br>1px x4<br>2px x4<br>6px x3<br>24px x1 |
| transitionDuration (8 vs 2) | 0.06s x94<br>0.45s x41<br>0.2s x18<br>0.15s x10<br>0.12s x3<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x20<br>0.2s x1 |
| transitionTimingFunction (6 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x73<br>cubic-bezier(0.165, 0.84, 0.44, 1) x53<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x41<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x20<br>cubic-bezier(0.32, 0.72, 0, 1) x1 |
| animationName (4 vs 2) | task-grid-fade-in, task-grid-clip-reveal x1<br>cds-fade-in x1<br>fade-in x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1 | exit x1<br>live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x24<br>1px x1 |

root custom properties: claude.ai 1383, cairn 72

## chat-long / initial

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 628 vs 234

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 17, 195.5x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 12px | 9px |
| button.primary | paddingLeft | 12px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | text | default |
| composer.box | count, size | 1, 768x44 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.36) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 24x24 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 19px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderTopLeftRadius | 6px | 8px |
| composer.button | borderTopRightRadius | 6px | 8px |
| composer.button | borderBottomRightRadius | 6px | 8px |
| composer.button | borderBottomLeftRadius | 6px | 8px |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 710x21 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgba(0, 0, 0, 0.9) | rgb(63, 108, 53) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 128.6x24 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 6px | 8px |
| composer.model | borderTopRightRadius | 6px | 8px |
| composer.model | borderBottomRightRadius | 6px | 8px |
| composer.model | borderBottomLeftRadius | 6px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 8px | 0px |
| composer.model | paddingLeft | 8px | 0px |
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
| jump | color | rgba(0, 0, 0, 0.9) | rgb(75, 83, 77) |
| jump | backgroundColor | oklab(0.999994 0.0000455677 0.0000200868 / 0.8) | rgb(253, 253, 251) |
| jump | borderTopWidth | 0.8px | 0px |
| jump | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderRightWidth | 0.8px | 0px |
| jump | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderBottomWidth | 0.8px | 0px |
| jump | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderLeftWidth | 0.8px | 0px |
| jump | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderTopLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderTopRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | boxShadow | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, hsl(none 0% 4.31373% / 0.08) 0px 6px 16px 0p | none |
| jump | outlineWidth | 1.6px | 3px |
| jump | outlineStyle | solid | none |
| jump | outlineColor | rgba(35, 112, 205, 0) | rgb(75, 83, 77) |
| jump | outlineOffset | 1.6px | 0px |
| jump | paddingTop | 4px | 0px |
| jump | paddingRight | 4px | 0px |
| jump | paddingBottom | 4px | 0px |
| jump | paddingLeft | 4px | 0px |
| jump | transitionProperty | opacity, border-color | opacity |
| jump | transitionDuration | 0.2s | 0s |
| jump | cursor | pointer | default |
| jump | backdropFilter | blur(8px) | none |
| jump | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| message.actions.button | count, size | 3, 24x24 | 13, 24x24 |
| message.actions.button | position | relative | static |
| message.actions.button | fontFamily | anthropic-sans | instrumentSans |
| message.actions.button | fontSize | 13px | 14px |
| message.actions.button | fontWeight | 435 | 500 |
| message.actions.button | lineHeight | 19px | 20px |
| message.actions.button | color | rgba(0, 0, 0, 0.6) | rgb(95, 102, 95) |
| message.actions.button | borderTopStyle | solid | none |
| message.actions.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| message.actions.button | borderRightStyle | solid | none |
| message.actions.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| message.actions.button | borderBottomStyle | solid | none |
| message.actions.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| message.actions.button | borderLeftStyle | solid | none |
| message.actions.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| message.actions.button | borderTopLeftRadius | 6px | 0px |
| message.actions.button | borderTopRightRadius | 6px | 0px |
| message.actions.button | borderBottomRightRadius | 6px | 0px |
| message.actions.button | borderBottomLeftRadius | 6px | 0px |
| message.actions.button | outlineWidth | 1.6px | 3px |
| message.actions.button | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| message.actions.button | outlineOffset | 1.6px | 0px |
| message.actions.button | rowGap | 6px | normal |
| message.actions.button | columnGap | 6px | normal |
| message.actions.button | transitionProperty | box-shadow | all |
| message.actions.button | transitionDuration | 0.06s | 0s |
| message.reply | presence | absent | 5 |
| message.reply.p | presence | absent | 5 |
| message.user | presence | absent | 4 |
| message.user.bubble | presence | absent | 4 |
| project.card | presence | absent | 1 |
| shell.header | presence | absent | 1 |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 2, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 19, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 2, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.section | outlineOffset | 1.6px | 0px |
| sidebar.section | paddingRight | 0px | 8px |
| sidebar.section | paddingLeft | 0px | 8px |
| sidebar.section | rowGap | 6px | 8px |
| sidebar.section | columnGap | 6px | 8px |
| sidebar.section | transitionProperty | box-shadow | all |
| sidebar.section | transitionDuration | 0.06s | 0.15s |
| sidebar.section | cursor | pointer | default |
| table.td | presence | 12 | absent |
| table.th | presence | 4 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 1) | Anthropicons-Variable x46<br>anthropic-sans x44<br>anthropic-serif x30<br>anthropic-mono x3 | instrumentSans x32 |
| fontSize (8 vs 5) | 20px x37<br>15px x30<br>14px x26<br>12px x13<br>16px x9<br>13px x4<br>13.5px x3<br>11px x1 | 15px x10<br>12px x8<br>14px x7<br>13px x6<br>20px x1 |
| fontWeight (8 vs 4) | 400 x38<br>433.25 x36<br>435 x24<br>600 x12<br>533.25 x9<br>520 x2<br>500 x1<br>577.75 x1 | 450 x18<br>500 x8<br>600 x5<br>650 x1 |
| lineHeight (8 vs 6) | 21px x54<br>20px x41<br>12px x9<br>16px x9<br>13.5px x3<br>19px x3<br>18px x2<br>17px x2 | 22.5px x10<br>16px x8<br>20px x6<br>18px x6<br>26px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x123 | normal x32 |
| color (7 vs 5) | rgba(0, 0, 0, 0.9) x93<br>rgba(0, 0, 0, 0.6) x22<br>oklab(0 0 0 / 0.901961) x3<br>rgba(0, 0, 0, 0.467) x2<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1 | rgb(29, 35, 31) x19<br>rgb(75, 83, 77) x6<br>rgb(95, 102, 95) x5<br>rgb(255, 255, 255) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (10 vs 11) | rgb(255, 255, 255) x8<br>rgba(0, 0, 0, 0.05) x3<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>hsl(none 0% 4.31373% / 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>color(srgb 1 1 1 / 0.85) x1<br>oklab(0.999994 0.0000455677 0.0000200868 / 0.8) x1 | rgb(253, 253, 251) x5<br>rgb(237, 240, 236) x4<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(95, 102, 95) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(35, 49, 39) x1<br>rgb(236, 238, 232) x1 |
| borderTopLeftRadius (7 vs 4) | 6px x91<br>8px x68<br>2.68435e+07px x3<br>4px x3<br>7px x2<br>5px x2<br>14px x1 | 8px x19<br>3.35544e+07px x7<br>12px x4<br>14px x3 |
| boxShadow (5 vs 3) | hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, hsl(none 0% 4. x1<br>color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgb(255, 255, 255) 0px 0px 0px 32px x1<br>rgba(0, 0, 0, 0.06) 0px 0px 0px 0.5px, rgba(0, 0, 0, 0.06) 0 x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (2 vs 2) | rgba(0, 0, 0, 0.1) x8<br>rgba(0, 0, 0, 0.08) x1 | rgba(0, 0, 0, 0) x9<br>rgb(220, 223, 215) x1 |
| borderTopWidth (1 vs 1) | 0.8px x9 | 1px x10 |
| paddingTop (8 vs 6) | 7.5625px x16<br>4px x8<br>8px x6<br>1px x4<br>3.5px x3<br>16px x2<br>53px x1<br>24px x1 | 8px x5<br>2px x3<br>12px x2<br>4px x1<br>14px x1<br>6px x1 |
| paddingLeft (14 vs 10) | 8px x26<br>2px x23<br>4px x14<br>22.5px x12<br>7.5px x4<br>6px x4<br>1px x2<br>10px x2<br>12px x2<br>296px x1<br>9px x1<br>16px x1<br>30px x1<br>7px x1 | 12px x7<br>8px x5<br>10px x4<br>2px x3<br>4px x2<br>9px x2<br>6px x1<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (7 vs 6) | 4px x71<br>6px x40<br>2px x21<br>8px x5<br>1.8px x2<br>5px x2<br>20px x1 | 8px x19<br>4px x12<br>6px x8<br>1px x5<br>2px x4<br>10px x2 |
| columnGap (7 vs 6) | 4px x71<br>6px x40<br>2px x21<br>8px x4<br>1.8px x2<br>5px x2<br>20px x1 | 8px x18<br>4px x12<br>6px x8<br>1px x5<br>2px x4<br>10px x3 |
| transitionDuration (9 vs 1) | 0.06s x79<br>0.45s x34<br>0.2s x8<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.3s x1<br>0.12s, 0s x1 | 0.15s x10 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x50<br>cubic-bezier(0.165, 0.84, 0.44, 1) x43<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x34<br>cubic-bezier(0.32, 0.72, 0, 1) x2<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (1 vs 0) | task-grid-fade-in, task-grid-clip-reveal x1 |  |
| strokeWidth (2 vs 2) | 1px x1<br>1.25px x1 | 1.75px x28<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## chat-long / scroll-up

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 660 vs 271

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 14, 195.5x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 768x44 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.36) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 24x24 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 19px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderTopLeftRadius | 6px | 8px |
| composer.button | borderTopRightRadius | 6px | 8px |
| composer.button | borderBottomRightRadius | 6px | 8px |
| composer.button | borderBottomLeftRadius | 6px | 8px |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 710x21 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgba(0, 0, 0, 0.9) | rgb(63, 108, 53) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 128.6x24 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 6px | 8px |
| composer.model | borderTopRightRadius | 6px | 8px |
| composer.model | borderBottomRightRadius | 6px | 8px |
| composer.model | borderBottomLeftRadius | 6px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 8px | 0px |
| composer.model | paddingLeft | 8px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | count, size | 1, 195.5x28 | 1, 728x32 |
| home.greeting | display | flex | block |
| home.greeting | fontFamily | anthropic-sans | sourceSerif4 |
| home.greeting | fontSize | 14px | 26px |
| home.greeting | fontWeight | 400 | 600 |
| home.greeting | lineHeight | 20px | 32px |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | whiteSpace | normal | nowrap |
| home.greeting | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| home.greeting | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| jump | count, size | 1, 36x36 | 1, 32x32 |
| jump | fontFamily | anthropic-sans | instrumentSans |
| jump | fontWeight | 400 | 500 |
| jump | lineHeight | 21px | 20px |
| jump | whiteSpace | normal | nowrap |
| jump | color | rgba(0, 0, 0, 0.9) | rgb(75, 83, 77) |
| jump | backgroundColor | oklab(0.999994 0.0000455677 0.0000200868 / 0.8) | rgb(253, 253, 251) |
| jump | borderTopWidth | 0.8px | 0px |
| jump | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderRightWidth | 0.8px | 0px |
| jump | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderBottomWidth | 0.8px | 0px |
| jump | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderLeftWidth | 0.8px | 0px |
| jump | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderTopLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderTopRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | boxShadow | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, hsl(none 0% 4.31373% / 0.08) 0px 6px 16px 0p | none |
| jump | outlineWidth | 1.6px | 3px |
| jump | outlineStyle | solid | none |
| jump | outlineColor | rgba(35, 112, 205, 0) | rgb(75, 83, 77) |
| jump | outlineOffset | 1.6px | 0px |
| jump | paddingTop | 4px | 0px |
| jump | paddingRight | 4px | 0px |
| jump | paddingBottom | 4px | 0px |
| jump | paddingLeft | 4px | 0px |
| jump | transitionProperty | opacity, border-color | opacity |
| jump | transitionDuration | 0.2s | 0s |
| jump | cursor | pointer | default |
| jump | backdropFilter | blur(8px) | none |
| jump | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| message.actions.button | presence | absent | 17 |
| message.reply | presence | absent | 6 |
| message.reply.p | presence | absent | 6 |
| message.user | count, size | 1, 575x63 | 6, 395.8x38.5 |
| message.user | display | grid | block |
| message.user | position | relative | static |
| message.user | fontFamily | anthropic-sans | instrumentSans |
| message.user | fontWeight | 400 | 450 |
| message.user | lineHeight | 21px | 22.5px |
| message.user | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| message.user | backgroundColor | rgba(0, 0, 0, 0) | rgb(237, 240, 236) |
| message.user | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| message.user | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| message.user | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| message.user | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| message.user | borderTopLeftRadius | 0px | 12px |
| message.user | borderTopRightRadius | 0px | 12px |
| message.user | borderBottomRightRadius | 0px | 12px |
| message.user | borderBottomLeftRadius | 0px | 12px |
| message.user | outlineWidth | 2.4px | 3px |
| message.user | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| message.user | paddingTop | 0px | 8px |
| message.user | paddingRight | 0px | 12px |
| message.user | paddingBottom | 0px | 8px |
| message.user | paddingLeft | 0px | 12px |
| message.user | rowGap | 8px | normal |
| message.user | columnGap | 8px | normal |
| message.user | maxWidth | none | 100% |
| message.user.bubble | count, size | 1, 607x87 | 6, 395.8x38.5 |
| message.user.bubble | display | flex | block |
| message.user.bubble | position | relative | static |
| message.user.bubble | fontFamily | anthropic-sans | instrumentSans |
| message.user.bubble | fontWeight | 400 | 450 |
| message.user.bubble | lineHeight | 21px | 22.5px |
| message.user.bubble | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| message.user.bubble | backgroundColor | hsl(none 0% 4.31373% / 0.05) | rgb(237, 240, 236) |
| message.user.bubble | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| message.user.bubble | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| message.user.bubble | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| message.user.bubble | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| message.user.bubble | outlineWidth | 2.4px | 3px |
| message.user.bubble | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| message.user.bubble | paddingTop | 12px | 8px |
| message.user.bubble | paddingRight | 16px | 12px |
| message.user.bubble | paddingBottom | 12px | 8px |
| message.user.bubble | paddingLeft | 16px | 12px |
| message.user.bubble | rowGap | 8px | normal |
| message.user.bubble | columnGap | 8px | normal |
| message.user.bubble | maxWidth | 607px | 100% |
| project.card | presence | absent | 1 |
| shell.header | presence | absent | 1 |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 2, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 19, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 2, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (4 vs 2) | anthropic-mono x61<br>anthropic-sans x49<br>Anthropicons-Variable x42<br>anthropic-serif x10 | instrumentSans x36<br>sourceSerif4 x1 |
| fontSize (7 vs 6) | 14px x79<br>20px x38<br>12px x14<br>15px x12<br>13.5px x11<br>16px x4<br>13px x4 | 15px x13<br>12px x8<br>14px x7<br>13px x7<br>20px x1<br>26px x1 |
| fontWeight (8 vs 4) | 400 x91<br>433.25 x37<br>435 x24<br>533.25 x4<br>520 x2<br>600 x2<br>500 x1<br>577.75 x1 | 450 x22<br>500 x8<br>600 x6<br>650 x1 |
| lineHeight (9 vs 7) | 22.75px x50<br>20px x42<br>21px x39<br>13.5px x11<br>12px x9<br>16px x4<br>19px x3<br>18px x2<br>17px x2 | 22.5px x13<br>16px x8<br>18px x7<br>20px x6<br>26px x1<br>32px x1<br>21px x1 |
| letterSpacing (1 vs 2) | normal x162 | normal x36<br>-0.26px x1 |
| color (15 vs 5) | rgba(0, 0, 0, 0.9) x78<br>rgb(43, 48, 59) x22<br>rgba(0, 0, 0, 0.6) x19<br>oklab(0 0 0 / 0.901961) x11<br>rgb(20, 24, 31) x9<br>rgb(129, 0, 194) x6<br>rgb(0, 128, 128) x5<br>rgb(179, 74, 0) x3<br>rgb(0, 81, 194) x2<br>rgb(184, 79, 5) x2<br>rgb(16, 161, 34) x1<br>rgb(110, 118, 135) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgba(0, 0, 0, 0.467) x1 | rgb(29, 35, 31) x23<br>rgb(75, 83, 77) x6<br>rgb(95, 102, 95) x6<br>rgb(255, 255, 255) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (11 vs 11) | rgba(0, 0, 0, 0.05) x11<br>rgb(255, 255, 255) x10<br>hsl(none 0% 4.31373% / 0.05) x2<br>rgb(250, 250, 250) x1<br>rgba(0, 0, 0, 0.1) x1<br>hsl(none 0% 4.31373% / 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>color(srgb 1 1 1 / 0.85) x1<br>oklab(0.999994 0.0000455678 0.0000200868 / 0.5) x1<br>oklab(0.999994 0.0000455677 0.0000200868 / 0.8) x1 | rgb(237, 240, 236) x6<br>rgb(253, 253, 251) x5<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(95, 102, 95) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(35, 49, 39) x1<br>rgb(236, 238, 232) x1 |
| borderTopLeftRadius (8 vs 4) | 6px x76<br>8px x73<br>4px x11<br>2.68435e+07px x3<br>12px x3<br>7px x2<br>5px x2<br>14px x1 | 8px x19<br>3.35544e+07px x7<br>12px x6<br>14px x3 |
| boxShadow (5 vs 3) | hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, hsl(none 0% 4. x1<br>color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgb(255, 255, 255) 0px 0px 0px 32px x1<br>rgba(0, 0, 0, 0.06) 0px 0px 0px 0.5px, rgba(0, 0, 0, 0.06) 0 x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (1 vs 2) | rgba(0, 0, 0, 0.08) x2 | rgba(0, 0, 0, 0) x9<br>rgb(220, 223, 215) x1 |
| borderTopWidth (1 vs 1) | 0.8px x2 | 1px x10 |
| paddingTop (10 vs 7) | 1px x12<br>4px x7<br>8px x6<br>3.5px x4<br>16px x2<br>14px x2<br>53px x1<br>12px x1<br>1.875px x1<br>24px x1 | 8px x7<br>2px x3<br>12px x2<br>4px x1<br>14px x1<br>24px x1<br>6px x1 |
| paddingLeft (14 vs 10) | 8px x28<br>2px x23<br>4px x20<br>6px x4<br>7.5px x4<br>1px x2<br>10px x2<br>12px x2<br>16px x2<br>14px x2<br>296px x1<br>9px x1<br>30px x1<br>7px x1 | 12px x9<br>8px x5<br>10px x4<br>2px x3<br>4px x2<br>9px x2<br>6px x1<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (7 vs 6) | 4px x67<br>6px x36<br>2px x21<br>8px x10<br>1.8px x2<br>5px x2<br>20px x1 | 8px x22<br>4px x15<br>6px x8<br>2px x5<br>1px x5<br>10px x2 |
| columnGap (7 vs 6) | 4px x67<br>6px x36<br>2px x21<br>8px x9<br>1.8px x2<br>5px x2<br>20px x1 | 8px x21<br>4px x15<br>6px x8<br>2px x5<br>1px x5<br>10px x3 |
| transitionDuration (8 vs 1) | 0.06s x70<br>0.45s x30<br>0.2s x8<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x10 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x46<br>cubic-bezier(0.165, 0.84, 0.44, 1) x38<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x30<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (1 vs 0) | task-grid-fade-in, task-grid-clip-reveal x1 |  |
| strokeWidth (1 vs 2) | 1.25px x1 | 1.75px x32<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## chat-long / jump-to-latest

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 636 vs 234

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 17, 195.5x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 12px | 9px |
| button.primary | paddingLeft | 12px | 9px |
| button.primary | rowGap | 6px | 4px |
| button.primary | columnGap | 6px | 4px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| button.primary | cursor | text | default |
| composer.box | count, size | 1, 768x44 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.22) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 24x24 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 19px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderTopLeftRadius | 6px | 8px |
| composer.button | borderTopRightRadius | 6px | 8px |
| composer.button | borderBottomRightRadius | 6px | 8px |
| composer.button | borderBottomLeftRadius | 6px | 8px |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 710x21 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 128.6x24 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 6px | 8px |
| composer.model | borderTopRightRadius | 6px | 8px |
| composer.model | borderBottomRightRadius | 6px | 8px |
| composer.model | borderBottomLeftRadius | 6px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 8px | 0px |
| composer.model | paddingLeft | 8px | 0px |
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
| jump | color | rgba(0, 0, 0, 0.9) | rgb(75, 83, 77) |
| jump | backgroundColor | oklab(0.999994 0.0000455677 0.0000200868 / 0.8) | rgb(253, 253, 251) |
| jump | borderTopWidth | 0.8px | 0px |
| jump | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderRightWidth | 0.8px | 0px |
| jump | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderBottomWidth | 0.8px | 0px |
| jump | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderLeftWidth | 0.8px | 0px |
| jump | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderTopLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderTopRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | boxShadow | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, hsl(none 0% 4.31373% / 0.08) 0px 6px 16px 0p | none |
| jump | outlineWidth | 1.6px | 3px |
| jump | outlineStyle | solid | none |
| jump | outlineColor | rgba(35, 112, 205, 0) | rgb(75, 83, 77) |
| jump | outlineOffset | 1.6px | 0px |
| jump | paddingTop | 4px | 0px |
| jump | paddingRight | 4px | 0px |
| jump | paddingBottom | 4px | 0px |
| jump | paddingLeft | 4px | 0px |
| jump | transitionProperty | opacity, border-color | opacity |
| jump | transitionDuration | 0.2s | 0s |
| jump | cursor | pointer | default |
| jump | backdropFilter | blur(8px) | none |
| jump | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| message.actions.button | count, size | 3, 24x24 | 13, 24x24 |
| message.actions.button | position | relative | static |
| message.actions.button | fontFamily | anthropic-sans | instrumentSans |
| message.actions.button | fontSize | 13px | 14px |
| message.actions.button | fontWeight | 435 | 500 |
| message.actions.button | lineHeight | 19px | 20px |
| message.actions.button | color | rgba(0, 0, 0, 0.6) | rgb(95, 102, 95) |
| message.actions.button | borderTopStyle | solid | none |
| message.actions.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| message.actions.button | borderRightStyle | solid | none |
| message.actions.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| message.actions.button | borderBottomStyle | solid | none |
| message.actions.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| message.actions.button | borderLeftStyle | solid | none |
| message.actions.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| message.actions.button | borderTopLeftRadius | 6px | 0px |
| message.actions.button | borderTopRightRadius | 6px | 0px |
| message.actions.button | borderBottomRightRadius | 6px | 0px |
| message.actions.button | borderBottomLeftRadius | 6px | 0px |
| message.actions.button | outlineWidth | 1.6px | 3px |
| message.actions.button | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| message.actions.button | outlineOffset | 1.6px | 0px |
| message.actions.button | rowGap | 6px | normal |
| message.actions.button | columnGap | 6px | normal |
| message.actions.button | transitionProperty | box-shadow | all |
| message.actions.button | transitionDuration | 0.06s | 0s |
| message.reply | presence | absent | 5 |
| message.reply.p | presence | absent | 5 |
| message.user | presence | absent | 4 |
| message.user.bubble | presence | absent | 4 |
| project.card | presence | absent | 1 |
| shell.header | presence | absent | 1 |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 2, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 20, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 2, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.section | outlineOffset | 1.6px | 0px |
| sidebar.section | paddingRight | 0px | 8px |
| sidebar.section | paddingLeft | 0px | 8px |
| sidebar.section | rowGap | 6px | 8px |
| sidebar.section | columnGap | 6px | 8px |
| sidebar.section | transitionProperty | box-shadow | all |
| sidebar.section | transitionDuration | 0.06s | 0.15s |
| sidebar.section | cursor | pointer | default |
| table.td | presence | 12 | absent |
| table.th | presence | 4 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 1) | Anthropicons-Variable x47<br>anthropic-sans x44<br>anthropic-serif x30<br>anthropic-mono x3 | instrumentSans x32 |
| fontSize (8 vs 5) | 20px x38<br>15px x30<br>14px x26<br>12px x13<br>16px x9<br>13px x4<br>13.5px x3<br>11px x1 | 15px x10<br>12px x8<br>14px x7<br>13px x6<br>20px x1 |
| fontWeight (8 vs 4) | 400 x38<br>433.25 x37<br>435 x24<br>600 x12<br>533.25 x9<br>520 x2<br>500 x1<br>577.75 x1 | 450 x18<br>500 x8<br>600 x5<br>650 x1 |
| lineHeight (8 vs 6) | 21px x54<br>20px x42<br>12px x9<br>16px x9<br>13.5px x3<br>19px x3<br>18px x2<br>17px x2 | 22.5px x10<br>16px x8<br>20px x6<br>18px x6<br>26px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x124 | normal x32 |
| color (7 vs 5) | rgba(0, 0, 0, 0.9) x94<br>rgba(0, 0, 0, 0.6) x22<br>oklab(0 0 0 / 0.901961) x3<br>rgba(0, 0, 0, 0.467) x2<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1 | rgb(29, 35, 31) x19<br>rgb(75, 83, 77) x6<br>rgb(95, 102, 95) x5<br>rgb(255, 255, 255) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (10 vs 11) | rgb(255, 255, 255) x10<br>rgba(0, 0, 0, 0.05) x3<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>hsl(none 0% 4.31373% / 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>color(srgb 1 1 1 / 0.85) x1<br>oklab(0.999994 0.0000455677 0.0000200868 / 0.8) x1 | rgb(253, 253, 251) x5<br>rgb(237, 240, 236) x4<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(95, 102, 95) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(35, 49, 39) x1<br>rgb(236, 238, 232) x1 |
| borderTopLeftRadius (7 vs 4) | 6px x94<br>8px x68<br>2.68435e+07px x3<br>4px x3<br>7px x2<br>5px x2<br>14px x1 | 8px x19<br>3.35544e+07px x7<br>12px x4<br>14px x3 |
| boxShadow (5 vs 3) | hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, hsl(none 0% 4. x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgb(255, 255, 255) 0px 0px 0px 32px x1<br>rgba(0, 0, 0, 0.06) 0px 0px 0px 0.5px, rgba(0, 0, 0, 0.06) 0 x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (2 vs 2) | rgba(0, 0, 0, 0.1) x8<br>rgba(0, 0, 0, 0.08) x1 | rgba(0, 0, 0, 0) x9<br>rgb(220, 223, 215) x1 |
| borderTopWidth (1 vs 1) | 0.8px x9 | 1px x10 |
| paddingTop (8 vs 6) | 7.5625px x16<br>4px x8<br>8px x6<br>1px x4<br>3.5px x3<br>16px x2<br>53px x1<br>24px x1 | 8px x5<br>2px x3<br>12px x2<br>4px x1<br>14px x1<br>6px x1 |
| paddingLeft (14 vs 10) | 8px x26<br>2px x23<br>4px x14<br>22.5px x12<br>7.5px x4<br>6px x4<br>1px x2<br>10px x2<br>12px x2<br>296px x1<br>9px x1<br>16px x1<br>30px x1<br>7px x1 | 12px x7<br>8px x5<br>10px x4<br>2px x3<br>4px x2<br>9px x2<br>6px x1<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (7 vs 6) | 4px x72<br>6px x41<br>2px x22<br>8px x5<br>1.8px x2<br>5px x2<br>20px x1 | 8px x19<br>4px x12<br>6px x8<br>1px x5<br>2px x4<br>10px x2 |
| columnGap (7 vs 6) | 4px x72<br>6px x41<br>2px x22<br>8px x4<br>1.8px x2<br>5px x2<br>20px x1 | 8px x18<br>4px x12<br>6px x8<br>1px x5<br>2px x4<br>10px x3 |
| transitionDuration (9 vs 1) | 0.06s x81<br>0.45s x35<br>0.2s x8<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.3s x1<br>0.12s, 0s x1 | 0.15s x10 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x51<br>cubic-bezier(0.165, 0.84, 0.44, 1) x44<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x35<br>cubic-bezier(0.32, 0.72, 0, 1) x2<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (1 vs 0) | task-grid-fade-in, task-grid-clip-reveal x1 |  |
| strokeWidth (2 vs 2) | 1px x1<br>1.25px x1 | 1.75px x28<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## chat-long / hover-code-block

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 691 vs 313

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 13, 195.5x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 768x44 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.22) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 24x24 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 19px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderTopLeftRadius | 6px | 8px |
| composer.button | borderTopRightRadius | 6px | 8px |
| composer.button | borderBottomRightRadius | 6px | 8px |
| composer.button | borderBottomLeftRadius | 6px | 8px |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 710x21 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 128.6x24 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 6px | 8px |
| composer.model | borderTopRightRadius | 6px | 8px |
| composer.model | borderBottomRightRadius | 6px | 8px |
| composer.model | borderBottomLeftRadius | 6px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 8px | 0px |
| composer.model | paddingLeft | 8px | 0px |
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
| jump | color | rgba(0, 0, 0, 0.9) | rgb(75, 83, 77) |
| jump | backgroundColor | oklab(0.999994 0.0000455677 0.0000200868 / 0.8) | rgb(253, 253, 251) |
| jump | borderTopWidth | 0.8px | 0px |
| jump | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderRightWidth | 0.8px | 0px |
| jump | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderBottomWidth | 0.8px | 0px |
| jump | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderLeftWidth | 0.8px | 0px |
| jump | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderTopLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderTopRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | boxShadow | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, hsl(none 0% 4.31373% / 0.08) 0px 6px 16px 0p | none |
| jump | outlineWidth | 1.6px | 3px |
| jump | outlineStyle | solid | none |
| jump | outlineColor | rgba(35, 112, 205, 0) | rgb(75, 83, 77) |
| jump | outlineOffset | 1.6px | 0px |
| jump | paddingTop | 4px | 0px |
| jump | paddingRight | 4px | 0px |
| jump | paddingBottom | 4px | 0px |
| jump | paddingLeft | 4px | 0px |
| jump | transitionProperty | opacity, border-color | opacity |
| jump | transitionDuration | 0.2s | 0s |
| jump | cursor | pointer | default |
| jump | backdropFilter | blur(8px) | none |
| jump | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| message.actions.button | presence | absent | 22 |
| message.reply | presence | absent | 8 |
| message.reply.p | presence | absent | 8 |
| message.user | presence | absent | 8 |
| message.user.bubble | presence | absent | 8 |
| project.card | presence | absent | 1 |
| shell.header | presence | absent | 1 |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 2, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 20, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 2, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (4 vs 1) | anthropic-mono x111<br>anthropic-sans x44<br>Anthropicons-Variable x43<br>anthropic-serif x9 | instrumentSans x39 |
| fontSize (7 vs 5) | 14px x118<br>20px x39<br>13.5px x19<br>12px x14<br>15px x9<br>16px x4<br>13px x4 | 15px x17<br>12px x8<br>14px x7<br>13px x6<br>20px x1 |
| fontWeight (7 vs 4) | 400 x137<br>433.25 x38<br>435 x24<br>533.25 x4<br>520 x2<br>500 x1<br>577.75 x1 | 450 x25<br>500 x8<br>600 x5<br>650 x1 |
| lineHeight (9 vs 6) | 22.75px x92<br>20px x43<br>21px x33<br>13.5px x19<br>12px x9<br>16px x4<br>19px x3<br>18px x2<br>17px x2 | 22.5px x17<br>16px x8<br>20px x6<br>18px x6<br>26px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x207 | normal x39 |
| color (15 vs 5) | rgba(0, 0, 0, 0.9) x74<br>rgb(43, 48, 59) x41<br>oklab(0 0 0 / 0.901961) x19<br>rgba(0, 0, 0, 0.6) x18<br>rgb(0, 128, 128) x18<br>rgb(20, 24, 31) x13<br>rgb(129, 0, 194) x7<br>rgb(0, 81, 194) x4<br>rgb(110, 118, 135) x4<br>rgb(179, 74, 0) x3<br>rgb(184, 79, 5) x2<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgba(0, 0, 0, 0.467) x1 | rgb(29, 35, 31) x26<br>rgb(75, 83, 77) x6<br>rgb(95, 102, 95) x5<br>rgb(255, 255, 255) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (11 vs 11) | rgba(0, 0, 0, 0.05) x19<br>rgb(255, 255, 255) x10<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>hsl(none 0% 4.31373% / 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>color(srgb 1 1 1 / 0.85) x1<br>oklab(0.999994 0.0000455678 0.0000200868 / 0.5) x1<br>oklab(0.999994 0.0000455677 0.0000200868 / 0.8) x1 | rgb(237, 240, 236) x8<br>rgb(253, 253, 251) x5<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(95, 102, 95) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(35, 49, 39) x1<br>rgb(236, 238, 232) x1 |
| borderTopLeftRadius (8 vs 4) | 6px x79<br>8px x71<br>4px x19<br>2.68435e+07px x3<br>7px x2<br>5px x2<br>12px x2<br>14px x1 | 8px x19<br>12px x8<br>3.35544e+07px x7<br>14px x3 |
| boxShadow (5 vs 3) | hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, hsl(none 0% 4. x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgb(255, 255, 255) 0px 0px 0px 32px x1<br>rgba(0, 0, 0, 0.06) 0px 0px 0px 0.5px, rgba(0, 0, 0, 0.06) 0 x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (1 vs 2) | rgba(0, 0, 0, 0.08) x2 | rgba(0, 0, 0, 0) x9<br>rgb(220, 223, 215) x1 |
| borderTopWidth (1 vs 1) | 0.8px x2 | 1px x10 |
| paddingTop (8 vs 6) | 1px x20<br>4px x7<br>8px x6<br>3.5px x3<br>16px x2<br>14px x2<br>53px x1<br>24px x1 | 8px x9<br>2px x3<br>12px x2<br>4px x1<br>14px x1<br>6px x1 |
| paddingLeft (14 vs 10) | 4px x28<br>8px x27<br>2px x23<br>7.5px x4<br>6px x3<br>1px x2<br>10px x2<br>12px x2<br>14px x2<br>296px x1<br>9px x1<br>16px x1<br>30px x1<br>7px x1 | 12px x11<br>8px x5<br>10px x4<br>2px x3<br>4px x2<br>9px x2<br>6px x1<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (7 vs 6) | 4px x68<br>6px x37<br>2px x22<br>8px x5<br>1.8px x2<br>5px x2<br>20px x1 | 8px x29<br>4px x18<br>6px x8<br>1px x5<br>2px x4<br>10px x2 |
| columnGap (7 vs 6) | 4px x68<br>6px x37<br>2px x22<br>8px x4<br>1.8px x2<br>5px x2<br>20px x1 | 8px x28<br>4px x18<br>6px x8<br>1px x5<br>2px x4<br>10px x3 |
| transitionDuration (8 vs 1) | 0.06s x72<br>0.45s x31<br>0.2s x8<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x10 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x47<br>cubic-bezier(0.165, 0.84, 0.44, 1) x39<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x31<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (1 vs 0) | task-grid-fade-in, task-grid-clip-reveal x1 |  |
| strokeWidth (1 vs 2) | 1.25px x1 | 1.75px x37<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## chat-long / open-side-panel

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 733 vs 362

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 14, 195.5x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 768x44 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.22) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| composer.box | paddingTop | 8px | 12px |
| composer.box | paddingRight | 8px | 14px |
| composer.box | paddingBottom | 8px | 10px |
| composer.box | paddingLeft | 8px | 14px |
| composer.box | marginTop | 0px | 8px |
| composer.box | marginRight | 0px | 18px |
| composer.box | marginBottom | 0px | 24px |
| composer.box | marginLeft | 0px | 18px |
| composer.box | rowGap | 8px | normal |
| composer.box | maxWidth | none | 728px |
| composer.box | transitionProperty | background-color, border-color, box-shadow, opacity | all |
| composer.box | transitionDuration | 0.2s | 0s |
| composer.box | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| composer.box | cursor | text | auto |
| composer.button | count, size | 3, 24x24 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 19px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderTopLeftRadius | 6px | 8px |
| composer.button | borderTopRightRadius | 6px | 8px |
| composer.button | borderBottomRightRadius | 6px | 8px |
| composer.button | borderBottomLeftRadius | 6px | 8px |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 710x21 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 128.6x24 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontSize | 13px | 14px |
| composer.model | fontWeight | 435 | 500 |
| composer.model | lineHeight | 19px | 20px |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 6px | 8px |
| composer.model | borderTopRightRadius | 6px | 8px |
| composer.model | borderBottomRightRadius | 6px | 8px |
| composer.model | borderBottomLeftRadius | 6px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 8px | 0px |
| composer.model | paddingLeft | 8px | 0px |
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
| jump | color | rgba(0, 0, 0, 0.9) | rgb(75, 83, 77) |
| jump | backgroundColor | oklab(0.999994 0.0000455677 0.0000200868 / 0.8) | rgb(253, 253, 251) |
| jump | borderTopWidth | 0.8px | 0px |
| jump | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderRightWidth | 0.8px | 0px |
| jump | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderBottomWidth | 0.8px | 0px |
| jump | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderLeftWidth | 0.8px | 0px |
| jump | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| jump | borderTopLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderTopRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomRightRadius | 2.68435e+07px | 3.35544e+07px |
| jump | borderBottomLeftRadius | 2.68435e+07px | 3.35544e+07px |
| jump | boxShadow | hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, hsl(none 0% 4.31373% / 0.08) 0px 6px 16px 0p | none |
| jump | outlineWidth | 1.6px | 3px |
| jump | outlineStyle | solid | none |
| jump | outlineColor | rgba(35, 112, 205, 0) | rgb(75, 83, 77) |
| jump | outlineOffset | 1.6px | 0px |
| jump | paddingTop | 4px | 0px |
| jump | paddingRight | 4px | 0px |
| jump | paddingBottom | 4px | 0px |
| jump | paddingLeft | 4px | 0px |
| jump | transitionProperty | opacity, border-color | opacity |
| jump | transitionDuration | 0.2s | 0s |
| jump | cursor | pointer | default |
| jump | backdropFilter | blur(8px) | none |
| jump | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| message.actions.button | presence | absent | 22 |
| message.reply | presence | absent | 8 |
| message.reply.p | presence | absent | 8 |
| message.user | presence | absent | 8 |
| message.user.bubble | presence | absent | 8 |
| project.card | presence | absent | 1 |
| shell.header | presence | absent | 2 |
| shell.main | count, size | 1, 1440x900 | 1, 764x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 2, 288x900 | 2, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 20, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | backgroundColor | rgba(0, 0, 0, 0) | rgb(220, 222, 215) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 2, 288x900 | 1, 224x28 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(220, 222, 215) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(220, 223, 215) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row.fill | borderTopLeftRadius | 0px | 8px |
| sidebar.row.fill | borderTopRightRadius | 0px | 8px |
| sidebar.row.fill | borderBottomRightRadius | 0px | 8px |
| sidebar.row.fill | borderBottomLeftRadius | 0px | 8px |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (4 vs 1) | anthropic-mono x111<br>anthropic-sans x46<br>Anthropicons-Variable x44<br>anthropic-serif x9 | instrumentSans x47 |
| fontSize (8 vs 5) | 14px x119<br>20px x39<br>13.5px x19<br>12px x14<br>15px x9<br>13px x5<br>16px x4<br>18px x1 | 15px x18<br>14px x10<br>12px x9<br>13px x9<br>20px x1 |
| fontWeight (8 vs 4) | 400 x138<br>433.25 x38<br>435 x25<br>533.25 x4<br>520 x2<br>500 x1<br>577.75 x1<br>492.5 x1 | 450 x29<br>500 x11<br>600 x6<br>650 x1 |
| lineHeight (9 vs 6) | 22.75px x92<br>20px x44<br>21px x33<br>13.5px x19<br>12px x9<br>16px x4<br>18px x3<br>17px x3<br>19px x3 | 22.5px x18<br>16px x9<br>20px x9<br>18px x9<br>26px x1<br>21px x1 |
| letterSpacing (1 vs 1) | normal x210 | normal x47 |
| color (15 vs 5) | rgba(0, 0, 0, 0.9) x75<br>rgb(43, 48, 59) x41<br>rgba(0, 0, 0, 0.6) x20<br>oklab(0 0 0 / 0.901961) x19<br>rgb(0, 128, 128) x18<br>rgb(20, 24, 31) x13<br>rgb(129, 0, 194) x7<br>rgb(0, 81, 194) x4<br>rgb(110, 118, 135) x4<br>rgb(179, 74, 0) x3<br>rgb(184, 79, 5) x2<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgba(0, 0, 0, 0.467) x1 | rgb(29, 35, 31) x29<br>rgb(75, 83, 77) x8<br>rgb(95, 102, 95) x8<br>rgb(255, 255, 255) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (12 vs 12) | rgba(0, 0, 0, 0.05) x19<br>rgb(255, 255, 255) x10<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>hsl(none 0% 4.31373% / 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.145) x1<br>color(srgb 1 1 1 / 0.85) x1<br>oklab(0.999994 0.0000455678 0.0000200868 / 0.5) x1<br>oklab(0.999994 0.0000455677 0.0000200868 / 0.8) x1 | rgb(237, 240, 236) x8<br>rgb(253, 253, 251) x7<br>rgb(236, 238, 232) x4<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(246, 246, 242) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(220, 222, 215) x1<br>rgb(95, 102, 95) x1<br>rgb(168, 174, 166) x1<br>rgb(35, 49, 39) x1 |
| borderTopLeftRadius (8 vs 4) | 6px x79<br>8px x74<br>4px x19<br>2.68435e+07px x3<br>7px x2<br>5px x2<br>12px x2<br>14px x1 | 8px x26<br>3.35544e+07px x8<br>12px x8<br>14px x4 |
| boxShadow (4 vs 4) | hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>hsl(none 0% 4.31373% / 0.07) 0px 2px 4px 0px, hsl(none 0% 4. x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgb(255, 255, 255) 0px 0px 0px 32px x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgb(220, 223, 215) 1px 0px 0px 0px inset x1 |
| borderTopColor (1 vs 2) | rgba(0, 0, 0, 0.08) x2 | rgba(0, 0, 0, 0) x12<br>rgb(220, 223, 215) x2 |
| borderTopWidth (1 vs 1) | 0.8px x2 | 1px x14 |
| paddingTop (9 vs 8) | 1px x20<br>4px x7<br>8px x6<br>3.5px x3<br>16px x2<br>14px x2<br>53px x1<br>24px x1<br>48px x1 | 8px x9<br>2px x5<br>12px x4<br>4px x1<br>14px x1<br>6px x1<br>10px x1<br>20px x1 |
| paddingLeft (14 vs 10) | 4px x28<br>8px x27<br>2px x23<br>7.5px x4<br>12px x3<br>6px x3<br>1px x2<br>10px x2<br>14px x2<br>296px x1<br>9px x1<br>16px x1<br>30px x1<br>7px x1 | 12px x11<br>8px x5<br>2px x5<br>10px x4<br>20px x3<br>16px x3<br>6px x2<br>4px x2<br>9px x2<br>14px x2 |
| rowGap (9 vs 6) | 4px x69<br>6px x38<br>2px x22<br>8px x5<br>1.8px x2<br>5px x2<br>20px x1<br>12px x1<br>16px x1 | 8px x31<br>4px x20<br>6px x12<br>2px x6<br>1px x5<br>10px x2 |
| columnGap (9 vs 6) | 4px x69<br>6px x38<br>2px x22<br>8px x4<br>1.8px x2<br>5px x2<br>20px x1<br>12px x1<br>16px x1 | 8px x30<br>4px x20<br>6px x12<br>2px x6<br>1px x5<br>10px x3 |
| transitionDuration (8 vs 1) | 0.06s x74<br>0.45s x32<br>0.2s x8<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x15 |
| transitionTimingFunction (6 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x48<br>cubic-bezier(0.165, 0.84, 0.44, 1) x40<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x32<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x14<br>cubic-bezier(0.2, 0, 0, 1) x1 |
| animationName (3 vs 0) | task-grid-fade-in, task-grid-clip-reveal x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1<br>cds-flipbook x1 |  |
| strokeWidth (2 vs 2) | 1.25px x1<br>1px x1 | 1.75px x43<br>1px x4 |

root custom properties: claude.ai 1383, cairn 72

## search-palette / initial

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 618 vs 200

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 28x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.36) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgba(0, 0, 0, 0.9) | rgb(63, 108, 53) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | count, size | 1, 1x1 | 1, 728x32 |
| home.greeting | position | absolute | static |
| home.greeting | fontFamily | anthropic-sans | sourceSerif4 |
| home.greeting | fontSize | 14px | 26px |
| home.greeting | fontWeight | 400 | 600 |
| home.greeting | lineHeight | 21px | 32px |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| home.greeting | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| home.greeting | marginTop | -1px | 0px |
| home.greeting | marginRight | -1px | 0px |
| home.greeting | marginBottom | -1px | 0px |
| home.greeting | marginLeft | -1px | 0px |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 1152x45 | 1, 1184x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 19, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (3 vs 3) | anthropic-sans x53<br>Anthropicons-Variable x42<br>anthropic-serif x2 | instrumentSans x51<br>jetbrainsMono x2<br>sourceSerif4 x1 |
| fontSize (7 vs 7) | 20px x37<br>14px x37<br>12px x14<br>16px x4<br>13px x3<br>32px x1<br>15px x1 | 14px x29<br>12px x10<br>13px x10<br>15px x2<br>20px x1<br>26px x1<br>17px x1 |
| fontWeight (8 vs 5) | 433.25 x36<br>435 x27<br>400 x24<br>533.25 x4<br>520 x2<br>577.75 x2<br>500 x1<br>360 x1 | 450 x33<br>500 x10<br>600 x7<br>700 x3<br>650 x1 |
| lineHeight (6 vs 10) | 20px x50<br>21px x27<br>12px x10<br>16px x7<br>18px x2<br>38.4px x1 | 24px x23<br>16px x8<br>18px x8<br>20px x7<br>22.5px x2<br>16.8px x2<br>26px x1<br>32px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 2) | normal x97 | normal x53<br>-0.26px x1 |
| color (6 vs 6) | rgba(0, 0, 0, 0.9) x70<br>rgba(0, 0, 0, 0.6) x21<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1 | rgb(29, 35, 31) x31<br>rgb(95, 102, 95) x13<br>rgb(75, 83, 77) x7<br>rgb(255, 255, 255) x1<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (10 vs 12) | rgb(255, 255, 255) x13<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgb(249, 249, 249) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1 | rgb(253, 253, 251) x5<br>rgb(236, 238, 232) x4<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(95, 102, 95) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(35, 49, 39) x1 |
| borderTopLeftRadius (7 vs 5) | 8px x91<br>6px x65<br>7px x19<br>11px x12<br>5px x2<br>2.68435e+07px x2<br>14px x1 | 8px x19<br>3.35544e+07px x8<br>14px x3<br>4px x3<br>12px x2 |
| boxShadow (5 vs 3) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (1 vs 2) | hsl(none 0% 4.31373% / 0.2) x4 | rgba(0, 0, 0, 0) x9<br>rgb(220, 223, 215) x2 |
| borderTopWidth (1 vs 1) | 0.8px x4 | 1px x11 |
| paddingTop (8 vs 8) | 8px x10<br>4px x8<br>3.5px x3<br>14px x3<br>16px x2<br>1px x1<br>297.1px x1<br>12px x1 | 8px x3<br>1px x3<br>2px x3<br>12px x2<br>4px x1<br>14px x1<br>24px x1<br>6px x1 |
| paddingLeft (11 vs 10) | 8px x29<br>2px x23<br>4px x8<br>10px x7<br>14px x3<br>1px x2<br>12px x2<br>296px x1<br>56px x1<br>6px x1<br>9px x1 | 8px x5<br>10px x5<br>12px x4<br>6px x3<br>4px x3<br>2px x3<br>9px x2<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x8<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x16<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x2 |
| columnGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x6<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x15<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x3 |
| transitionDuration (8 vs 1) | 0.06s x77<br>0.45s x39<br>0.2s x16<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x10 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x50<br>cubic-bezier(0.165, 0.84, 0.44, 1) x49<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x39<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (2 vs 1) | static-composer-actions-fade-in x7<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x18<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## search-palette / open-palette

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 773 vs 246

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 28x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.22) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| dialog | count, size | 1, 672x583.6 | 1, 640x250 |
| dialog | display | block | flex |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontSize | 16px | 14px |
| dialog | fontWeight | 400 | 450 |
| dialog | lineHeight | 24px | 21px |
| dialog | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog | backgroundColor | rgba(0, 0, 0, 0) | rgb(246, 246, 242) |
| dialog | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderTopLeftRadius | 20px | 18px |
| dialog | borderTopRightRadius | 20px | 18px |
| dialog | borderBottomRightRadius | 20px | 18px |
| dialog | borderBottomLeftRadius | 20px | 18px |
| dialog | boxShadow | none | rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29, 35, 31, 0.25) 0px 24px 48px -12px, rgb(2 |
| dialog | outlineWidth | 2.4px | 3px |
| dialog | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| dialog | maxWidth | 672px | 1408px |
| dialog | transitionProperty | scale | opacity, scale |
| dialog | transitionDuration | 0.12s | 0.1s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | cubic-bezier(0, 0, 0.2, 1) |
| dialog | animationName | none | enter |
| dialog | animationDuration | 0s | 0.1s |
| dialog | animationTimingFunction | ease | cubic-bezier(0, 0, 0.2, 1) |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.4)","color":"rgba(0, 0, 0, 0.9)","radius":"20px"," | null |
| home.greeting | count, size | 1, 1x1 | 1, 728x32 |
| home.greeting | position | absolute | static |
| home.greeting | fontFamily | anthropic-sans | sourceSerif4 |
| home.greeting | fontSize | 14px | 26px |
| home.greeting | fontWeight | 400 | 600 |
| home.greeting | lineHeight | 21px | 32px |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| home.greeting | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| home.greeting | marginTop | -1px | 0px |
| home.greeting | marginRight | -1px | 0px |
| home.greeting | marginBottom | -1px | 0px |
| home.greeting | marginLeft | -1px | 0px |
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
| shell.header | count, size | 1, 1152x45 | 1, 1184x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 19, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(75, 83, 77) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(75, 83, 77) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (4 vs 3) | anthropic-sans x86<br>Anthropicons-Variable x56<br>anthropic-serif x2<br>anthropic-sans-display x1 | instrumentSans x61<br>jetbrainsMono x2<br>sourceSerif4 x1 |
| fontSize (8 vs 7) | 14px x52<br>20px x46<br>12px x35<br>16px x6<br>13px x3<br>32px x1<br>15px x1<br>22px x1 | 14px x33<br>12px x16<br>13px x10<br>15px x2<br>20px x1<br>26px x1<br>17px x1 |
| fontWeight (8 vs 5) | 400 x49<br>433.25 x45<br>435 x35<br>533.25 x6<br>577.75 x5<br>520 x3<br>500 x1<br>360 x1 | 450 x40<br>500 x13<br>600 x7<br>700 x3<br>650 x1 |
| lineHeight (8 vs 10) | 20px x74<br>21px x27<br>12px x20<br>16px x12<br>17px x8<br>18px x2<br>38.4px x1<br>28px x1 | 24px x23<br>16px x14<br>20px x11<br>18px x8<br>22.5px x2<br>16.8px x2<br>26px x1<br>32px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 2) | normal x145 | normal x63<br>-0.26px x1 |
| color (7 vs 6) | rgba(0, 0, 0, 0.9) x82<br>rgba(0, 0, 0, 0.6) x47<br>rgb(107, 107, 107) x10<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1 | rgb(29, 35, 31) x34<br>rgb(95, 102, 95) x19<br>rgb(75, 83, 77) x8<br>rgb(255, 255, 255) x1<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (12 vs 12) | rgb(255, 255, 255) x16<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgba(0, 0, 0, 0.1) x3<br>rgb(249, 249, 249) x3<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgb(198, 97, 63) x1 | rgb(253, 253, 251) x5<br>rgb(236, 238, 232) x4<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(95, 102, 95) x2<br>rgb(246, 246, 242) x2<br>rgb(29, 35, 31) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(35, 49, 39) x1<br>rgba(29, 35, 31, 0.28) x1 |
| borderTopLeftRadius (9 vs 6) | 8px x102<br>6px x68<br>7px x19<br>11px x12<br>4px x7<br>5px x5<br>2.68435e+07px x3<br>20px x3<br>14px x1 | 8px x24<br>3.35544e+07px x8<br>4px x7<br>14px x3<br>12px x2<br>18px x1 |
| boxShadow (7 vs 4) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x1<br>rgba(0, 0, 0, 0.25) 0px 25px 50px -12px x1<br>color(srgb 0 0 0 / 0.06) 0px 2px 8px 0px x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1<br>rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29, 35, 31, 0. x1 |
| borderTopColor (3 vs 3) | color(srgb 0.419608 0.419608 0.419608 / 0.18) x7<br>hsl(none 0% 4.31373% / 0.2) x5<br>rgba(0, 0, 0, 0.1) x2 | rgba(0, 0, 0, 0) x10<br>oklab(0.501923 -0.0114304 0.00792146 / 0.22) x4<br>rgb(220, 223, 215) x3 |
| borderTopWidth (1 vs 1) | 0.8px x14 | 1px x17 |
| paddingTop (11 vs 8) | 8px x19<br>4px x8<br>12px x4<br>3.5px x3<br>14px x3<br>16px x2<br>10px x2<br>1px x1<br>297.1px x1<br>17.6px x1<br>6px x1 | 8px x5<br>1px x3<br>2px x3<br>4px x2<br>12px x2<br>14px x1<br>24px x1<br>6px x1 |
| paddingLeft (14 vs 10) | 8px x29<br>2px x23<br>10px x14<br>12px x10<br>4px x8<br>14px x6<br>24px x3<br>3px x3<br>1px x2<br>6px x2<br>296px x1<br>56px x1<br>9px x1<br>20px x1 | 10px x10<br>8px x5<br>6px x5<br>12px x4<br>4px x4<br>2px x3<br>16px x2<br>9px x2<br>14px x2<br>20px x1 |
| rowGap (10 vs 7) | 4px x69<br>6px x50<br>2px x26<br>8px x24<br>12px x9<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>20px x1 | 8px x16<br>6px x12<br>4px x11<br>2px x10<br>10px x6<br>1px x5<br>16px x1 |
| columnGap (10 vs 7) | 4px x69<br>6px x50<br>2px x26<br>8px x22<br>12px x9<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>20px x1 | 8px x15<br>6px x12<br>4px x11<br>2px x10<br>10px x7<br>1px x5<br>16px x1 |
| transitionDuration (8 vs 3) | 0.06s x83<br>0.45s x42<br>0.2s x18<br>0.12s x5<br>0.15s x5<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x16<br>0.2s x1<br>0.1s x1 |
| transitionTimingFunction (7 vs 3) | cubic-bezier(0.165, 0.84, 0.44, 1) x58<br>cubic-bezier(0.4, 0, 0.2, 1) x53<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x42<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1<br>ease x1 | cubic-bezier(0.4, 0, 0.2, 1) x16<br>ease x1<br>cubic-bezier(0, 0, 0.2, 1) x1 |
| animationName (2 vs 2) | static-composer-actions-fade-in x7<br>task-grid-fade-in, task-grid-clip-reveal x1 | enter x2<br>live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x2 | 1.75px x27<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## search-palette / type-query

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 698 vs 265

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 28x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.22) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| dialog | count, size | 1, 672x158.8 | 1, 640x246 |
| dialog | display | block | flex |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontSize | 16px | 14px |
| dialog | fontWeight | 400 | 450 |
| dialog | lineHeight | 24px | 21px |
| dialog | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog | backgroundColor | rgba(0, 0, 0, 0) | rgb(246, 246, 242) |
| dialog | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderTopLeftRadius | 20px | 18px |
| dialog | borderTopRightRadius | 20px | 18px |
| dialog | borderBottomRightRadius | 20px | 18px |
| dialog | borderBottomLeftRadius | 20px | 18px |
| dialog | boxShadow | none | rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29, 35, 31, 0.25) 0px 24px 48px -12px, rgb(2 |
| dialog | outlineWidth | 2.4px | 3px |
| dialog | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| dialog | maxWidth | 672px | 1408px |
| dialog | transitionProperty | scale | opacity, scale |
| dialog | transitionDuration | 0.12s | 0.1s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | cubic-bezier(0, 0, 0.2, 1) |
| dialog | animationName | none | enter |
| dialog | animationDuration | 0s | 0.1s |
| dialog | animationTimingFunction | ease | cubic-bezier(0, 0, 0.2, 1) |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.4)","color":"rgba(0, 0, 0, 0.9)","radius":"20px"," | null |
| home.greeting | count, size | 1, 1x1 | 1, 728x32 |
| home.greeting | position | absolute | static |
| home.greeting | fontFamily | anthropic-sans | sourceSerif4 |
| home.greeting | fontSize | 14px | 26px |
| home.greeting | fontWeight | 400 | 600 |
| home.greeting | lineHeight | 21px | 32px |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| home.greeting | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| home.greeting | marginTop | -1px | 0px |
| home.greeting | marginRight | -1px | 0px |
| home.greeting | marginBottom | -1px | 0px |
| home.greeting | marginLeft | -1px | 0px |
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
| shell.header | count, size | 1, 1152x45 | 1, 1184x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 19, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(75, 83, 77) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(75, 83, 77) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (4 vs 3) | anthropic-sans x72<br>Anthropicons-Variable x47<br>anthropic-serif x2<br>anthropic-sans-display x1 | instrumentSans x66<br>jetbrainsMono x2<br>sourceSerif4 x1 |
| fontSize (8 vs 7) | 14px x46<br>20px x39<br>12px x24<br>16px x7<br>13px x3<br>32px x1<br>15px x1<br>22px x1 | 14px x32<br>12px x18<br>13px x14<br>15px x2<br>20px x1<br>26px x1<br>17px x1 |
| fontWeight (8 vs 5) | 433.25 x38<br>435 x35<br>400 x34<br>533.25 x6<br>520 x4<br>577.75 x3<br>500 x1<br>360 x1 | 450 x43<br>500 x15<br>600 x7<br>700 x3<br>650 x1 |
| lineHeight (9 vs 10) | 20px x61<br>21px x27<br>12px x16<br>16px x9<br>17px x4<br>18px x2<br>38.4px x1<br>28px x1<br>24px x1 | 24px x23<br>16px x16<br>18px x12<br>20px x10<br>22.5px x2<br>16.8px x2<br>26px x1<br>32px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 2) | normal x122 | normal x68<br>-0.26px x1 |
| color (7 vs 6) | rgba(0, 0, 0, 0.9) x84<br>rgba(0, 0, 0, 0.6) x26<br>rgb(107, 107, 107) x6<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1 | rgb(29, 35, 31) x33<br>rgb(95, 102, 95) x25<br>rgb(75, 83, 77) x8<br>rgb(255, 255, 255) x1<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (11 vs 12) | rgb(255, 255, 255) x16<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgba(0, 0, 0, 0.1) x3<br>rgb(249, 249, 249) x3<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1<br>rgba(0, 0, 0, 0.4) x1 | rgb(253, 253, 251) x5<br>rgb(236, 238, 232) x4<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(95, 102, 95) x2<br>rgb(246, 246, 242) x2<br>rgb(29, 35, 31) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(35, 49, 39) x1<br>rgba(29, 35, 31, 0.28) x1 |
| borderTopLeftRadius (9 vs 6) | 8px x95<br>6px x68<br>7px x19<br>11px x12<br>5px x5<br>4px x5<br>20px x3<br>2.68435e+07px x2<br>14px x1 | 8px x23<br>4px x9<br>3.35544e+07px x8<br>14px x3<br>12px x2<br>18px x1 |
| boxShadow (7 vs 4) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x1<br>rgba(0, 0, 0, 0.25) 0px 25px 50px -12px x1<br>color(srgb 0 0 0 / 0.06) 0px 2px 8px 0px x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1<br>rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29, 35, 31, 0. x1 |
| borderTopColor (3 vs 3) | hsl(none 0% 4.31373% / 0.2) x5<br>color(srgb 0.419608 0.419608 0.419608 / 0.18) x5<br>rgba(0, 0, 0, 0.1) x2 | rgba(0, 0, 0, 0) x10<br>oklab(0.501923 -0.0114304 0.00792146 / 0.22) x6<br>rgb(220, 223, 215) x3 |
| borderTopWidth (1 vs 1) | 0.8px x12 | 1px x19 |
| paddingTop (11 vs 8) | 8px x12<br>4px x8<br>3.5px x3<br>14px x3<br>16px x2<br>10px x2<br>1px x1<br>297.1px x1<br>12px x1<br>17.6px x1<br>6px x1 | 8px x6<br>1px x3<br>2px x3<br>4px x2<br>12px x2<br>14px x1<br>24px x1<br>6px x1 |
| paddingLeft (14 vs 10) | 8px x29<br>2px x23<br>10px x14<br>4px x8<br>12px x3<br>14px x3<br>24px x3<br>3px x3<br>1px x2<br>6px x2<br>296px x1<br>56px x1<br>9px x1<br>20px x1 | 10px x10<br>12px x7<br>8px x5<br>6px x5<br>4px x5<br>2px x3<br>16px x2<br>9px x2<br>14px x2<br>20px x1 |
| rowGap (10 vs 7) | 4px x69<br>6px x50<br>2px x25<br>8px x13<br>5px x3<br>1.8px x2<br>12px x2<br>24px x1<br>28px x1<br>20px x1 | 8px x16<br>6px x15<br>4px x13<br>2px x11<br>1px x5<br>10px x5<br>16px x1 |
| columnGap (10 vs 7) | 4px x69<br>6px x50<br>2px x25<br>8px x11<br>5px x3<br>1.8px x2<br>12px x2<br>24px x1<br>28px x1<br>20px x1 | 8px x15<br>6px x15<br>4px x13<br>2px x11<br>10px x6<br>1px x5<br>16px x1 |
| transitionDuration (8 vs 3) | 0.06s x83<br>0.45s x42<br>0.2s x18<br>0.12s x5<br>0.15s x4<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x15<br>0.2s x1<br>0.1s x1 |
| transitionTimingFunction (7 vs 3) | cubic-bezier(0.165, 0.84, 0.44, 1) x57<br>cubic-bezier(0.4, 0, 0.2, 1) x53<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x42<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1<br>ease x1 | cubic-bezier(0.4, 0, 0.2, 1) x15<br>ease x1<br>cubic-bezier(0, 0, 0.2, 1) x1 |
| animationName (3 vs 2) | static-composer-actions-fade-in x7<br>task-grid-fade-in, task-grid-clip-reveal x1<br>cds-fade-in x1 | enter x2<br>live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x2 | 1.75px x27<br>1px x5 |

root custom properties: claude.ai 1383, cairn 72

## focus / initial

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 618 vs 200

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 28x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.36) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 2px |
| composer.input | outlineColor | rgba(0, 0, 0, 0.9) | rgb(63, 108, 53) |
| composer.input | outlineOffset | 0px | 2px |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | count, size | 1, 1x1 | 1, 728x32 |
| home.greeting | position | absolute | static |
| home.greeting | fontFamily | anthropic-sans | sourceSerif4 |
| home.greeting | fontSize | 14px | 26px |
| home.greeting | fontWeight | 400 | 600 |
| home.greeting | lineHeight | 21px | 32px |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| home.greeting | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| home.greeting | marginTop | -1px | 0px |
| home.greeting | marginRight | -1px | 0px |
| home.greeting | marginBottom | -1px | 0px |
| home.greeting | marginLeft | -1px | 0px |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 1152x45 | 1, 1184x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 19, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (3 vs 3) | anthropic-sans x53<br>Anthropicons-Variable x42<br>anthropic-serif x2 | instrumentSans x51<br>jetbrainsMono x2<br>sourceSerif4 x1 |
| fontSize (7 vs 7) | 20px x37<br>14px x37<br>12px x14<br>16px x4<br>13px x3<br>32px x1<br>15px x1 | 14px x29<br>12px x10<br>13px x10<br>15px x2<br>20px x1<br>26px x1<br>17px x1 |
| fontWeight (8 vs 5) | 433.25 x36<br>435 x27<br>400 x24<br>533.25 x4<br>520 x2<br>577.75 x2<br>500 x1<br>360 x1 | 450 x33<br>500 x10<br>600 x7<br>700 x3<br>650 x1 |
| lineHeight (6 vs 10) | 20px x50<br>21px x27<br>12px x10<br>16px x7<br>18px x2<br>38.4px x1 | 24px x23<br>16px x8<br>18px x8<br>20px x7<br>22.5px x2<br>16.8px x2<br>26px x1<br>32px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 2) | normal x97 | normal x53<br>-0.26px x1 |
| color (6 vs 6) | rgba(0, 0, 0, 0.9) x70<br>rgba(0, 0, 0, 0.6) x21<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1 | rgb(29, 35, 31) x31<br>rgb(95, 102, 95) x13<br>rgb(75, 83, 77) x7<br>rgb(255, 255, 255) x1<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (10 vs 12) | rgb(255, 255, 255) x13<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgb(249, 249, 249) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1 | rgb(253, 253, 251) x5<br>rgb(236, 238, 232) x4<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(95, 102, 95) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(35, 49, 39) x1 |
| borderTopLeftRadius (7 vs 5) | 8px x91<br>6px x65<br>7px x19<br>11px x12<br>5px x2<br>2.68435e+07px x2<br>14px x1 | 8px x19<br>3.35544e+07px x8<br>14px x3<br>4px x3<br>12px x2 |
| boxShadow (5 vs 3) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (1 vs 2) | hsl(none 0% 4.31373% / 0.2) x4 | rgba(0, 0, 0, 0) x9<br>rgb(220, 223, 215) x2 |
| borderTopWidth (1 vs 1) | 0.8px x4 | 1px x11 |
| paddingTop (8 vs 8) | 8px x10<br>4px x8<br>3.5px x3<br>14px x3<br>16px x2<br>1px x1<br>297.1px x1<br>12px x1 | 8px x3<br>1px x3<br>2px x3<br>12px x2<br>4px x1<br>14px x1<br>24px x1<br>6px x1 |
| paddingLeft (11 vs 10) | 8px x29<br>2px x23<br>4px x8<br>10px x7<br>14px x3<br>1px x2<br>12px x2<br>296px x1<br>56px x1<br>6px x1<br>9px x1 | 8px x5<br>10px x5<br>12px x4<br>6px x3<br>4px x3<br>2px x3<br>9px x2<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x8<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x16<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x2 |
| columnGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x6<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x15<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x3 |
| transitionDuration (8 vs 1) | 0.06s x77<br>0.45s x39<br>0.2s x16<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x10 |
| transitionTimingFunction (6 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x50<br>cubic-bezier(0.165, 0.84, 0.44, 1) x49<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x39<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (2 vs 1) | static-composer-actions-fade-in x7<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x18<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## focus / tab-1

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 623 vs 203

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 28x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.36) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | boxShadow | rgb(255, 255, 255) 0px 0px 0px 1px inset, rgb(37, 125, 224) 0px 0px 0px 1px, color(srgb 0. | none |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(0, 0, 0, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | outline | all |
| composer.button | transitionDuration | 0.2s | 0s |
| composer.button | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | count, size | 1, 1x1 | 1, 728x32 |
| home.greeting | position | absolute | static |
| home.greeting | fontFamily | anthropic-sans | sourceSerif4 |
| home.greeting | fontSize | 14px | 26px |
| home.greeting | fontWeight | 400 | 600 |
| home.greeting | lineHeight | 21px | 32px |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| home.greeting | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| home.greeting | marginTop | -1px | 0px |
| home.greeting | marginRight | -1px | 0px |
| home.greeting | marginBottom | -1px | 0px |
| home.greeting | marginLeft | -1px | 0px |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 1152x45 | 1, 1184x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 19, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.section | outlineOffset | 1.6px | 0px |
| sidebar.section | paddingRight | 0px | 8px |
| sidebar.section | paddingLeft | 0px | 8px |
| sidebar.section | rowGap | 6px | 8px |
| sidebar.section | columnGap | 6px | 8px |
| sidebar.section | transitionProperty | box-shadow | all |
| sidebar.section | transitionDuration | 0.06s | 0.15s |
| sidebar.section | cursor | pointer | default |
| tooltip | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 3) | anthropic-sans x55<br>Anthropicons-Variable x42<br>anthropic-serif x2 | instrumentSans x52<br>jetbrainsMono x2<br>sourceSerif4 x1 |
| fontSize (7 vs 7) | 20px x37<br>14px x37<br>12px x15<br>16px x4<br>13px x4<br>32px x1<br>15px x1 | 14px x29<br>12px x11<br>13px x10<br>15px x2<br>20px x1<br>26px x1<br>17px x1 |
| fontWeight (8 vs 5) | 433.25 x36<br>435 x27<br>400 x26<br>533.25 x4<br>520 x2<br>577.75 x2<br>500 x1<br>360 x1 | 450 x34<br>500 x10<br>600 x7<br>700 x3<br>650 x1 |
| lineHeight (6 vs 10) | 20px x50<br>21px x27<br>12px x10<br>16px x7<br>18px x4<br>38.4px x1 | 24px x23<br>16px x9<br>18px x8<br>20px x7<br>22.5px x2<br>16.8px x2<br>26px x1<br>32px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 2) | normal x99 | normal x54<br>-0.26px x1 |
| color (8 vs 7) | rgba(0, 0, 0, 0.9) x70<br>rgba(0, 0, 0, 0.6) x21<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgb(255, 255, 255) x1<br>rgba(255, 255, 255, 0.57) x1 | rgb(29, 35, 31) x31<br>rgb(95, 102, 95) x13<br>rgb(75, 83, 77) x7<br>rgb(255, 255, 255) x1<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1<br>rgb(246, 246, 242) x1 |
| backgroundColor (11 vs 12) | rgb(255, 255, 255) x13<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgb(249, 249, 249) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1<br>rgb(11, 11, 11) x1 | rgb(253, 253, 251) x5<br>rgb(236, 238, 232) x4<br>rgb(29, 35, 31) x3<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(95, 102, 95) x2<br>rgb(210, 214, 204) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(35, 49, 39) x1 |
| borderTopLeftRadius (7 vs 6) | 8px x91<br>6px x66<br>7px x19<br>11px x12<br>5px x2<br>2.68435e+07px x2<br>14px x1 | 8px x20<br>3.35544e+07px x8<br>14px x3<br>4px x3<br>12px x2<br>2px x1 |
| boxShadow (7 vs 3) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x2<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgb(255, 255, 255) 0px 0px 0px 1px inset, rgb(37, 125, 224)  x1<br>rgb(255, 255, 255) 0px 0px 0px 1px inset x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (1 vs 2) | hsl(none 0% 4.31373% / 0.2) x4 | rgba(0, 0, 0, 0) x9<br>rgb(220, 223, 215) x2 |
| borderTopWidth (1 vs 1) | 0.8px x4 | 1px x11 |
| paddingTop (9 vs 8) | 8px x10<br>4px x8<br>3.5px x3<br>14px x3<br>16px x2<br>1px x1<br>297.1px x1<br>12px x1<br>3px x1 | 8px x3<br>1px x3<br>2px x3<br>12px x2<br>6px x2<br>4px x1<br>14px x1<br>24px x1 |
| paddingLeft (11 vs 10) | 8px x30<br>2px x23<br>4px x8<br>10px x7<br>14px x3<br>1px x2<br>12px x2<br>296px x1<br>56px x1<br>6px x1<br>9px x1 | 12px x5<br>8px x5<br>10px x5<br>6px x3<br>4px x3<br>2px x3<br>9px x2<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x9<br>1.8px x3<br>5px x3<br>24px x1<br>28px x1<br>12px x1 | 8px x16<br>6px x9<br>2px x7<br>4px x6<br>1px x5<br>10px x2 |
| columnGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x7<br>1.8px x3<br>5px x3<br>24px x1<br>28px x1<br>12px x1 | 8px x15<br>6px x9<br>2px x7<br>4px x6<br>1px x5<br>10px x3 |
| transitionDuration (8 vs 1) | 0.06s x76<br>0.45s x39<br>0.2s x17<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x10 |
| transitionTimingFunction (7 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x49<br>cubic-bezier(0.165, 0.84, 0.44, 1) x49<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x39<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (2 vs 2) | static-composer-actions-fade-in x7<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1<br>enter x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x18<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## focus / tab-2

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 621 vs 200

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 28x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.36) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 2px |
| composer.model | outlineStyle | none | solid |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(63, 108, 53) |
| composer.model | outlineOffset | 1.6px | 2px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | count, size | 1, 1x1 | 1, 728x32 |
| home.greeting | position | absolute | static |
| home.greeting | fontFamily | anthropic-sans | sourceSerif4 |
| home.greeting | fontSize | 14px | 26px |
| home.greeting | fontWeight | 400 | 600 |
| home.greeting | lineHeight | 21px | 32px |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| home.greeting | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| home.greeting | marginTop | -1px | 0px |
| home.greeting | marginRight | -1px | 0px |
| home.greeting | marginBottom | -1px | 0px |
| home.greeting | marginLeft | -1px | 0px |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 1152x45 | 1, 1184x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 19, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.section | outlineOffset | 1.6px | 0px |
| sidebar.section | paddingRight | 0px | 8px |
| sidebar.section | paddingLeft | 0px | 8px |
| sidebar.section | rowGap | 6px | 8px |
| sidebar.section | columnGap | 6px | 8px |
| sidebar.section | transitionProperty | box-shadow | all |
| sidebar.section | transitionDuration | 0.06s | 0.15s |
| sidebar.section | cursor | pointer | default |
| tooltip | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 3) | anthropic-sans x54<br>Anthropicons-Variable x42<br>anthropic-serif x2 | instrumentSans x51<br>jetbrainsMono x2<br>sourceSerif4 x1 |
| fontSize (7 vs 7) | 20px x37<br>14px x37<br>12px x14<br>16px x4<br>13px x4<br>32px x1<br>15px x1 | 14px x29<br>12px x10<br>13px x10<br>15px x2<br>20px x1<br>26px x1<br>17px x1 |
| fontWeight (8 vs 5) | 433.25 x36<br>435 x27<br>400 x25<br>533.25 x4<br>520 x2<br>577.75 x2<br>500 x1<br>360 x1 | 450 x33<br>500 x10<br>600 x7<br>700 x3<br>650 x1 |
| lineHeight (6 vs 10) | 20px x50<br>21px x27<br>12px x10<br>16px x7<br>18px x3<br>38.4px x1 | 24px x23<br>16px x8<br>18px x8<br>20px x7<br>22.5px x2<br>16.8px x2<br>26px x1<br>32px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 2) | normal x98 | normal x53<br>-0.26px x1 |
| color (7 vs 6) | rgba(0, 0, 0, 0.9) x70<br>rgba(0, 0, 0, 0.6) x21<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgb(255, 255, 255) x1 | rgb(29, 35, 31) x31<br>rgb(95, 102, 95) x13<br>rgb(75, 83, 77) x7<br>rgb(255, 255, 255) x1<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (11 vs 12) | rgb(255, 255, 255) x13<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgb(249, 249, 249) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1<br>rgb(11, 11, 11) x1 | rgb(253, 253, 251) x5<br>rgb(236, 238, 232) x4<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(95, 102, 95) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(35, 49, 39) x1 |
| borderTopLeftRadius (7 vs 5) | 8px x91<br>6px x66<br>7px x19<br>11px x12<br>5px x2<br>2.68435e+07px x2<br>14px x1 | 8px x19<br>3.35544e+07px x8<br>14px x3<br>4px x3<br>12px x2 |
| boxShadow (7 vs 3) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x2<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgb(255, 255, 255) 0px 0px 0px 1px inset, rgb(37, 125, 224)  x1<br>rgb(255, 255, 255) 0px 0px 0px 1px inset x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (1 vs 2) | hsl(none 0% 4.31373% / 0.2) x4 | rgba(0, 0, 0, 0) x9<br>rgb(220, 223, 215) x2 |
| borderTopWidth (1 vs 1) | 0.8px x4 | 1px x11 |
| paddingTop (9 vs 8) | 8px x10<br>4px x8<br>3.5px x3<br>14px x3<br>16px x2<br>1px x1<br>297.1px x1<br>12px x1<br>3px x1 | 8px x3<br>1px x3<br>2px x3<br>12px x2<br>4px x1<br>14px x1<br>24px x1<br>6px x1 |
| paddingLeft (11 vs 10) | 8px x30<br>2px x23<br>4px x8<br>10px x7<br>14px x3<br>1px x2<br>12px x2<br>296px x1<br>56px x1<br>6px x1<br>9px x1 | 8px x5<br>10px x5<br>12px x4<br>6px x3<br>4px x3<br>2px x3<br>9px x2<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x9<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x16<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x2 |
| columnGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x7<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x15<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x3 |
| transitionDuration (8 vs 1) | 0.06s x76<br>0.45s x39<br>0.2s x17<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x10 |
| transitionTimingFunction (7 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x49<br>cubic-bezier(0.165, 0.84, 0.44, 1) x49<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x39<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (2 vs 1) | static-composer-actions-fade-in x7<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x18<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## focus / tab-3

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 621 vs 200

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 28x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.36) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | count, size | 1, 1x1 | 1, 728x32 |
| home.greeting | position | absolute | static |
| home.greeting | fontFamily | anthropic-sans | sourceSerif4 |
| home.greeting | fontSize | 14px | 26px |
| home.greeting | fontWeight | 400 | 600 |
| home.greeting | lineHeight | 21px | 32px |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| home.greeting | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| home.greeting | marginTop | -1px | 0px |
| home.greeting | marginRight | -1px | 0px |
| home.greeting | marginBottom | -1px | 0px |
| home.greeting | marginLeft | -1px | 0px |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 1152x45 | 1, 1184x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 19, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.section | outlineOffset | 1.6px | 0px |
| sidebar.section | paddingRight | 0px | 8px |
| sidebar.section | paddingLeft | 0px | 8px |
| sidebar.section | rowGap | 6px | 8px |
| sidebar.section | columnGap | 6px | 8px |
| sidebar.section | transitionProperty | box-shadow | all |
| sidebar.section | transitionDuration | 0.06s | 0.15s |
| sidebar.section | cursor | pointer | default |
| tooltip | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 3) | anthropic-sans x54<br>Anthropicons-Variable x42<br>anthropic-serif x2 | instrumentSans x51<br>jetbrainsMono x2<br>sourceSerif4 x1 |
| fontSize (7 vs 7) | 20px x37<br>14px x37<br>12px x14<br>16px x4<br>13px x4<br>32px x1<br>15px x1 | 14px x29<br>12px x10<br>13px x10<br>15px x2<br>20px x1<br>26px x1<br>17px x1 |
| fontWeight (8 vs 5) | 433.25 x36<br>435 x27<br>400 x25<br>533.25 x4<br>520 x2<br>577.75 x2<br>500 x1<br>360 x1 | 450 x33<br>500 x10<br>600 x7<br>700 x3<br>650 x1 |
| lineHeight (6 vs 10) | 20px x50<br>21px x27<br>12px x10<br>16px x7<br>18px x3<br>38.4px x1 | 24px x23<br>16px x8<br>18px x8<br>20px x7<br>22.5px x2<br>16.8px x2<br>26px x1<br>32px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 2) | normal x98 | normal x53<br>-0.26px x1 |
| color (7 vs 6) | rgba(0, 0, 0, 0.9) x70<br>rgba(0, 0, 0, 0.6) x21<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgb(255, 255, 255) x1 | rgb(29, 35, 31) x31<br>rgb(95, 102, 95) x13<br>rgb(75, 83, 77) x7<br>rgb(255, 255, 255) x1<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (11 vs 12) | rgb(255, 255, 255) x13<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgb(249, 249, 249) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1<br>rgb(11, 11, 11) x1 | rgb(253, 253, 251) x5<br>rgb(236, 238, 232) x4<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(95, 102, 95) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(35, 49, 39) x1 |
| borderTopLeftRadius (7 vs 5) | 8px x91<br>6px x66<br>7px x19<br>11px x12<br>5px x2<br>2.68435e+07px x2<br>14px x1 | 8px x19<br>3.35544e+07px x8<br>14px x3<br>4px x3<br>12px x2 |
| boxShadow (7 vs 3) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x2<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgb(255, 255, 255) 0px 0px 0px 1px inset, rgb(37, 125, 224)  x1<br>rgb(255, 255, 255) 0px 0px 0px 1px inset x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (1 vs 2) | hsl(none 0% 4.31373% / 0.2) x4 | rgba(0, 0, 0, 0) x9<br>rgb(220, 223, 215) x2 |
| borderTopWidth (1 vs 1) | 0.8px x4 | 1px x11 |
| paddingTop (9 vs 8) | 8px x10<br>4px x8<br>3.5px x3<br>14px x3<br>16px x2<br>1px x1<br>297.1px x1<br>12px x1<br>3px x1 | 8px x3<br>1px x3<br>2px x3<br>12px x2<br>4px x1<br>14px x1<br>24px x1<br>6px x1 |
| paddingLeft (11 vs 10) | 8px x30<br>2px x23<br>4px x8<br>10px x7<br>14px x3<br>1px x2<br>12px x2<br>296px x1<br>56px x1<br>6px x1<br>9px x1 | 8px x5<br>10px x5<br>12px x4<br>6px x3<br>4px x3<br>2px x3<br>9px x2<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x9<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x16<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x2 |
| columnGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x7<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x15<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x3 |
| transitionDuration (8 vs 1) | 0.06s x76<br>0.45s x39<br>0.2s x17<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x10 |
| transitionTimingFunction (7 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x49<br>cubic-bezier(0.165, 0.84, 0.44, 1) x49<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x39<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (2 vs 1) | static-composer-actions-fade-in x7<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x18<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## focus / tab-4

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 621 vs 200

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 15, 28x28 | 1, 53.7x26 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontSize | 14px | 13px |
| button.primary | fontWeight | 435 | 500 |
| button.primary | lineHeight | 20px | 18px |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
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
| composer.box | count, size | 1, 656x103 | 1, 728x86 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.22) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 5, 53.7x26 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontSize | 14px | 13px |
| composer.button | fontWeight | 435 | 500 |
| composer.button | lineHeight | 20px | 18px |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| composer.button | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | paddingRight | 0px | 9px |
| composer.button | paddingLeft | 0px | 9px |
| composer.button | rowGap | 6px | 4px |
| composer.button | columnGap | 6px | 4px |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.button | cursor | pointer | default |
| composer.input | count, size | 1, 632x50 | 1, 700x36 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | count, size | 1, 140.3x28 | 1, 28x28 |
| composer.model | display | inline-flex | flex |
| composer.model | position | relative | static |
| composer.model | fontFamily | anthropic-sans | instrumentSans |
| composer.model | fontWeight | 435 | 500 |
| composer.model | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.model | borderTopWidth | 0px | 1px |
| composer.model | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderRightWidth | 0px | 1px |
| composer.model | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderBottomWidth | 0px | 1px |
| composer.model | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderLeftWidth | 0px | 1px |
| composer.model | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.model | borderTopLeftRadius | 7px | 8px |
| composer.model | borderTopRightRadius | 7px | 8px |
| composer.model | borderBottomRightRadius | 7px | 8px |
| composer.model | borderBottomLeftRadius | 7px | 8px |
| composer.model | outlineWidth | 1.6px | 3px |
| composer.model | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.model | outlineOffset | 1.6px | 0px |
| composer.model | paddingRight | 10px | 0px |
| composer.model | paddingLeft | 10px | 0px |
| composer.model | rowGap | 6px | normal |
| composer.model | columnGap | 6px | normal |
| composer.model | maxWidth | 100% | none |
| composer.model | transitionProperty | box-shadow | all |
| composer.model | transitionDuration | 0.06s | 0s |
| home.greeting | count, size | 1, 1x1 | 1, 728x32 |
| home.greeting | position | absolute | static |
| home.greeting | fontFamily | anthropic-sans | sourceSerif4 |
| home.greeting | fontSize | 14px | 26px |
| home.greeting | fontWeight | 400 | 600 |
| home.greeting | lineHeight | 21px | 32px |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| home.greeting | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| home.greeting | marginTop | -1px | 0px |
| home.greeting | marginRight | -1px | 0px |
| home.greeting | marginBottom | -1px | 0px |
| home.greeting | marginLeft | -1px | 0px |
| jump | presence | absent | 1 |
| message.actions.button | presence | absent | 3 |
| message.reply | presence | absent | 2 |
| message.reply.heading | presence | absent | 1 |
| message.reply.p | presence | absent | 2 |
| message.reply.strong | presence | absent | 3 |
| message.user | presence | absent | 1 |
| message.user.bubble | presence | absent | 1 |
| project.card | presence | absent | 1 |
| shell.header | count, size | 1, 1152x45 | 1, 1184x48 |
| shell.header | display | block | flex |
| shell.header | position | relative | static |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.header | rowGap | normal | 2px |
| shell.header | columnGap | normal | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 19, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.section | outlineOffset | 1.6px | 0px |
| sidebar.section | paddingRight | 0px | 8px |
| sidebar.section | paddingLeft | 0px | 8px |
| sidebar.section | rowGap | 6px | 8px |
| sidebar.section | columnGap | 6px | 8px |
| sidebar.section | transitionProperty | box-shadow | all |
| sidebar.section | transitionDuration | 0.06s | 0.15s |
| sidebar.section | cursor | pointer | default |
| tooltip | presence | 1 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (3 vs 3) | anthropic-sans x54<br>Anthropicons-Variable x42<br>anthropic-serif x2 | instrumentSans x51<br>jetbrainsMono x2<br>sourceSerif4 x1 |
| fontSize (7 vs 7) | 20px x37<br>14px x37<br>12px x14<br>16px x4<br>13px x4<br>32px x1<br>15px x1 | 14px x29<br>12px x10<br>13px x10<br>15px x2<br>20px x1<br>26px x1<br>17px x1 |
| fontWeight (8 vs 5) | 433.25 x36<br>435 x27<br>400 x25<br>533.25 x4<br>520 x2<br>577.75 x2<br>500 x1<br>360 x1 | 450 x33<br>500 x10<br>600 x7<br>700 x3<br>650 x1 |
| lineHeight (6 vs 10) | 20px x50<br>21px x27<br>12px x10<br>16px x7<br>18px x3<br>38.4px x1 | 24px x23<br>16px x8<br>18px x8<br>20px x7<br>22.5px x2<br>16.8px x2<br>26px x1<br>32px x1<br>12px x1<br>21px x1 |
| letterSpacing (1 vs 2) | normal x98 | normal x53<br>-0.26px x1 |
| color (7 vs 6) | rgba(0, 0, 0, 0.9) x70<br>rgba(0, 0, 0, 0.6) x21<br>rgba(0, 0, 0, 0.467) x3<br>rgb(16, 161, 34) x1<br>rgb(135, 135, 135) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgb(255, 255, 255) x1 | rgb(29, 35, 31) x31<br>rgb(95, 102, 95) x13<br>rgb(75, 83, 77) x7<br>rgb(255, 255, 255) x1<br>rgb(110, 73, 0) x1<br>rgb(244, 246, 241) x1 |
| backgroundColor (11 vs 12) | rgb(255, 255, 255) x13<br>hsl(none 0% 4.31373% / 0.1) x9<br>rgb(249, 249, 249) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgba(0, 0, 0, 0.024) x1<br>rgba(37, 125, 224, 0.12) x1<br>rgb(11, 11, 11) x1 | rgb(253, 253, 251) x5<br>rgb(236, 238, 232) x4<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(95, 102, 95) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(237, 240, 236) x1<br>color(srgb 0.937804 0.908706 0.84651) x1<br>rgb(35, 49, 39) x1 |
| borderTopLeftRadius (7 vs 5) | 8px x91<br>6px x66<br>7px x19<br>11px x12<br>5px x2<br>2.68435e+07px x2<br>14px x1 | 8px x19<br>3.35544e+07px x8<br>14px x3<br>4px x3<br>12px x2 |
| boxShadow (7 vs 3) | hsl(none 0% 4.31373% / 0.08) 0px 4px 8px 0px, hsl(none 0% 4. x3<br>hsl(none 0% 4.31373% / 0.1) 0px 0px 0px 1px x3<br>hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x2<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.075) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgb(255, 255, 255) 0px 0px 0px 1px inset, rgb(37, 125, 224)  x1<br>rgb(255, 255, 255) 0px 0px 0px 1px inset x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (1 vs 2) | hsl(none 0% 4.31373% / 0.2) x4 | rgba(0, 0, 0, 0) x9<br>rgb(220, 223, 215) x2 |
| borderTopWidth (1 vs 1) | 0.8px x4 | 1px x11 |
| paddingTop (9 vs 8) | 8px x10<br>4px x8<br>3.5px x3<br>14px x3<br>16px x2<br>1px x1<br>297.1px x1<br>12px x1<br>3px x1 | 8px x3<br>1px x3<br>2px x3<br>12px x2<br>4px x1<br>14px x1<br>24px x1<br>6px x1 |
| paddingLeft (11 vs 10) | 8px x30<br>2px x23<br>4px x8<br>10px x7<br>14px x3<br>1px x2<br>12px x2<br>296px x1<br>56px x1<br>6px x1<br>9px x1 | 8px x5<br>10px x5<br>12px x4<br>6px x3<br>4px x3<br>2px x3<br>9px x2<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x9<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x16<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x2 |
| columnGap (9 vs 6) | 4px x65<br>6px x41<br>2px x22<br>8px x7<br>5px x3<br>1.8px x2<br>24px x1<br>28px x1<br>12px x1 | 8px x15<br>6px x8<br>2px x7<br>4px x6<br>1px x5<br>10px x3 |
| transitionDuration (8 vs 1) | 0.06s x76<br>0.45s x39<br>0.2s x17<br>0.12s x3<br>0.15s x2<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x10 |
| transitionTimingFunction (7 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x49<br>cubic-bezier(0.165, 0.84, 0.44, 1) x49<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x39<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1<br>ease x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (2 vs 1) | static-composer-actions-fade-in x7<br>task-grid-fade-in, task-grid-clip-reveal x1 | live-pulse x1 |
| strokeWidth (2 vs 2) | 1.25px x2<br>1px x1 | 1.75px x18<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## settings / initial

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 722 vs 230

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 28x28 | 2, 520x32 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0.15s |
| button.primary | cursor | pointer | default |
| composer.box | count, size | 1, 656x116 | 1, 139.2x34.4 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.22) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 2, 11.2x11.2 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | rowGap | 6px | normal |
| composer.button | columnGap | 6px | normal |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.input | count, size | 1, 632x63 | 1, 128x14.4 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | presence | 1 | absent |
| dialog | count, size | 1, 1024x800 | 3, 1216x852 |
| dialog | display | grid | flex |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 400 | 450 |
| dialog | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog | backgroundColor | rgb(255, 255, 255) | rgb(246, 246, 242) |
| dialog | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderTopLeftRadius | 12px | 14px |
| dialog | borderTopRightRadius | 12px | 14px |
| dialog | borderBottomRightRadius | 12px | 14px |
| dialog | borderBottomLeftRadius | 12px | 14px |
| dialog | boxShadow | rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.08) 0px 0px 0px 1px, hsl(none 0 | rgb(220, 223, 215) 0px 0px 0px 1px, rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29, 35,  |
| dialog | outlineWidth | 2.4px | 1px |
| dialog | outlineColor | rgb(35, 112, 205) | rgb(16, 16, 16) |
| dialog | marginTop | 50px | 0px |
| dialog | marginRight | 208px | 0px |
| dialog | marginBottom | 50px | 0px |
| dialog | marginLeft | 208px | 0px |
| dialog | maxWidth | 1024px | none |
| dialog | transitionProperty | opacity, scale | all |
| dialog | transitionDuration | 0.2s | 0s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | ease |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.4)","color":"rgba(0, 0, 0, 0.9)","radius":"12px"," | null |
| dialog.input | count, size | 2, 131.2x20 | 1, 520x32 |
| dialog.input | fontFamily | anthropic-sans | instrumentSans |
| dialog.input | fontWeight | 400 | 450 |
| dialog.input | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.input | borderTopWidth | 0px | 1px |
| dialog.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.input | borderRightWidth | 0px | 1px |
| dialog.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.input | borderBottomWidth | 0px | 1px |
| dialog.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.input | borderLeftWidth | 0px | 1px |
| dialog.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.input | borderTopLeftRadius | 0px | 8px |
| dialog.input | borderTopRightRadius | 0px | 8px |
| dialog.input | borderBottomRightRadius | 0px | 8px |
| dialog.input | borderBottomLeftRadius | 0px | 8px |
| dialog.input | outlineWidth | 2.4px | 3px |
| dialog.input | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.input | outlineOffset | 1.6px | 0px |
| dialog.input | paddingTop | 0px | 4px |
| dialog.input | paddingRight | 0px | 10px |
| dialog.input | paddingBottom | 0px | 4px |
| dialog.input | paddingLeft | 0px | 10px |
| dialog.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.input | transitionDuration | 0s | 0.15s |
| dialog.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.navitem | presence | 12 | absent |
| dialog.radiogroup | presence | 1 | absent |
| dialog.select | count, size | 8, 192.6x28 | 1, 89.8x32 |
| dialog.select | fontFamily | anthropic-sans | instrumentSans |
| dialog.select | fontWeight | 435 | 450 |
| dialog.select | whiteSpace | normal | nowrap |
| dialog.select | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.select | backgroundColor | rgba(0, 0, 0, 0) | rgb(253, 253, 251) |
| dialog.select | borderTopWidth | 0px | 1px |
| dialog.select | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderRightWidth | 0px | 1px |
| dialog.select | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderBottomWidth | 0px | 1px |
| dialog.select | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderLeftWidth | 0px | 1px |
| dialog.select | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderTopLeftRadius | 0px | 8px |
| dialog.select | borderTopRightRadius | 0px | 8px |
| dialog.select | borderBottomRightRadius | 0px | 8px |
| dialog.select | borderBottomLeftRadius | 0px | 8px |
| dialog.select | boxShadow | none | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px |
| dialog.select | outlineWidth | 1.6px | 3px |
| dialog.select | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| project.card | presence | absent | 4 |
| shell.header | count, size | 1, 1152x45 | 1, 152x16 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingTop | 0px | 4px |
| shell.header | paddingRight | 0px | 16px |
| shell.header | paddingBottom | 0px | 12px |
| shell.header | paddingLeft | 0px | 16px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.main | presence | 1 | absent |
| shell.sidebar | count, size | 1, 288x900 | 1, 152x240 |
| shell.sidebar | position | absolute | fixed |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(253, 253, 251) |
| shell.sidebar | opacity | 1 | 0 |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderTopLeftRadius | 0px | 18px |
| shell.sidebar | borderTopRightRadius | 0px | 18px |
| shell.sidebar | borderBottomRightRadius | 0px | 18px |
| shell.sidebar | borderBottomLeftRadius | 0px | 18px |
| shell.sidebar | boxShadow | none | rgb(220, 223, 215) 0px 0px 0px 1px inset, rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29 |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | maxWidth | none | 1424px |
| shell.sidebar | transitionProperty | all | none |
| shell.sidebar | transitionDuration | 0s | 0.2s |
| shell.sidebar | transitionTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| shell.sidebar | animationName | none | exit |
| shell.sidebar | animationDuration | 0s | 0.2s |
| shell.sidebar | animationTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| sidebar.footer | presence | 19 | absent |
| sidebar.navrow | presence | 5 | absent |
| sidebar.row | presence | 14 | absent |
| sidebar.row.fill | presence | 1 | absent |
| sidebar.section | presence | 21 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 2) | anthropic-sans x82<br>Anthropicons-Variable x65<br>anthropic-serif x3<br>anthropic-sans-display x1 | instrumentSans x49<br>sourceSerif4 x1 |
| fontSize (8 vs 7) | 14px x66<br>20px x52<br>12px x14<br>16px x12<br>15px x4<br>32px x1<br>22px x1<br>13px x1 | 14px x32<br>13px x7<br>12px x5<br>16px x2<br>17px x2<br>20px x1<br>15px x1 |
| fontWeight (8 vs 4) | 433.25 x51<br>435 x46<br>400 x32<br>533.25 x12<br>520 x6<br>577.75 x2<br>500 x1<br>360 x1 | 450 x34<br>500 x13<br>650 x2<br>600 x1 |
| lineHeight (8 vs 7) | 20px x96<br>21px x28<br>16px x12<br>12px x10<br>18px x2<br>38.4px x1<br>28px x1<br>17px x1 | 20px x32<br>18px x7<br>16px x5<br>22px x2<br>24px x2<br>26px x1<br>22.5px x1 |
| letterSpacing (1 vs 2) | normal x151 | normal x49<br>-0.35px x1 |
| color (4 vs 4) | rgba(0, 0, 0, 0.9) x116<br>rgba(0, 0, 0, 0.6) x33<br>rgb(16, 161, 34) x1<br>rgb(255, 255, 255) x1 | rgb(29, 35, 31) x20<br>rgb(75, 83, 77) x17<br>rgb(95, 102, 95) x11<br>rgb(244, 246, 241) x2 |
| backgroundColor (11 vs 9) | rgb(255, 255, 255) x8<br>rgba(255, 255, 255, 0.5) x5<br>hsl(none 0% 4.31373% / 0.05) x2<br>rgba(0, 0, 0, 0.1) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgb(198, 97, 63) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgb(25, 25, 25) x1 | rgb(253, 253, 251) x15<br>rgb(204, 208, 199) x3<br>rgb(255, 255, 255) x3<br>rgb(230, 231, 225) x2<br>rgb(35, 49, 39) x2<br>rgba(0, 0, 0, 0.6) x1<br>rgb(246, 246, 242) x1<br>rgb(210, 214, 204) x1<br>rgb(236, 238, 232) x1 |
| borderTopLeftRadius (7 vs 5) | 8px x112<br>6px x59<br>7px x6<br>5px x2<br>2.68435e+07px x2<br>14px x1<br>12px x1 | 8px x22<br>14px x14<br>3.35544e+07px x10<br>6px x1<br>18px x1 |
| boxShadow (4 vs 9) | rgba(0, 0, 0, 0.08) 0px 0px 0px 1px inset x5<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.0 x1 | rgb(220, 223, 215) 0px 0px 0px 1px x4<br>rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x3<br>rgb(220, 223, 215) 0px 0px 0px 1px, rgba(29, 35, 31, 0.08) 0 x1<br>rgb(220, 223, 215) 0px 0px 0px 1px inset x1<br>oklab(0.2486 -0.0105006 0.00462133 / 0.08) 0px 0px 0px 1px x1<br>rgba(29, 35, 31, 0.06) 0px 1px 2px 0px x1<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgb(220, 223, 215) 0px 0px 0px 1px inset, rgba(29, 35, 31, 0 x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (3 vs 3) | hsl(none 0% 4.31373% / 0.05) x7<br>hsl(none 0% 4.31373% / 0.1) x2<br>rgba(0, 0, 0, 0.08) x2 | rgba(0, 0, 0, 0) x4<br>rgb(204, 208, 199) x2<br>rgb(220, 223, 215) x1 |
| borderTopWidth (1 vs 1) | 0.8px x11 | 1px x7 |
| paddingTop (7 vs 8) | 12px x10<br>8px x7<br>4px x5<br>16px x4<br>1px x2<br>3.5px x2<br>297.1px x1 | 12px x6<br>4px x5<br>16px x5<br>6px x4<br>2px x3<br>8px x1<br>24px x1<br>14px x1 |
| paddingLeft (10 vs 9) | 8px x46<br>2px x23<br>10px x7<br>4px x4<br>16px x4<br>1px x3<br>12px x2<br>296px x1<br>56px x1<br>6px x1 | 10px x20<br>16px x14<br>2px x6<br>12px x5<br>8px x1<br>6px x1<br>4px x1<br>24px x1<br>14px x1 |
| rowGap (11 vs 9) | 4px x72<br>6px x56<br>2px x22<br>12px x16<br>28px x11<br>8px x8<br>1px x3<br>1.8px x2<br>5px x2<br>16px x2<br>24px x1 | 10px x14<br>12px x11<br>16px x10<br>8px x5<br>6px x5<br>1px x4<br>4px x3<br>2px x2<br>24px x1 |
| columnGap (10 vs 9) | 4px x72<br>6px x56<br>2px x22<br>12px x16<br>28px x11<br>8px x6<br>1.8px x2<br>5px x2<br>16px x2<br>24px x1 | 10px x14<br>12px x11<br>16px x10<br>8px x5<br>6px x5<br>1px x4<br>4px x3<br>2px x2<br>24px x1 |
| transitionDuration (8 vs 2) | 0.06s x83<br>0.45s x30<br>0.15s x9<br>0.2s x7<br>0.12s x3<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x26<br>0.2s x1 |
| transitionTimingFunction (6 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x65<br>cubic-bezier(0.165, 0.84, 0.44, 1) x38<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x30<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x26<br>cubic-bezier(0.32, 0.72, 0, 1) x1 |
| animationName (3 vs 1) | static-composer-actions-fade-in x6<br>task-grid-fade-in, task-grid-clip-reveal x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1 | exit x1 |
| strokeWidth (2 vs 1) | 1.25px x2<br>1px x1 | 1.75px x25 |

root custom properties: claude.ai 1383, cairn 72

## settings / settle-dialog

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 722 vs 230

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 28x28 | 2, 520x32 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0.15s |
| button.primary | cursor | pointer | default |
| composer.box | count, size | 1, 656x116 | 1, 139.2x34.4 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.22) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 2, 11.2x11.2 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | rowGap | 6px | normal |
| composer.button | columnGap | 6px | normal |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.input | count, size | 1, 632x63 | 1, 128x14.4 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | presence | 1 | absent |
| dialog | count, size | 1, 1024x800 | 3, 1216x852 |
| dialog | display | grid | flex |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 400 | 450 |
| dialog | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog | backgroundColor | rgb(255, 255, 255) | rgb(246, 246, 242) |
| dialog | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderTopLeftRadius | 12px | 14px |
| dialog | borderTopRightRadius | 12px | 14px |
| dialog | borderBottomRightRadius | 12px | 14px |
| dialog | borderBottomLeftRadius | 12px | 14px |
| dialog | boxShadow | rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.08) 0px 0px 0px 1px, hsl(none 0 | rgb(220, 223, 215) 0px 0px 0px 1px, rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29, 35,  |
| dialog | outlineWidth | 2.4px | 1px |
| dialog | outlineColor | rgb(35, 112, 205) | rgb(16, 16, 16) |
| dialog | marginTop | 50px | 0px |
| dialog | marginRight | 208px | 0px |
| dialog | marginBottom | 50px | 0px |
| dialog | marginLeft | 208px | 0px |
| dialog | maxWidth | 1024px | none |
| dialog | transitionProperty | opacity, scale | all |
| dialog | transitionDuration | 0.2s | 0s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | ease |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.4)","color":"rgba(0, 0, 0, 0.9)","radius":"12px"," | null |
| dialog.input | count, size | 2, 131.2x20 | 1, 520x32 |
| dialog.input | fontFamily | anthropic-sans | instrumentSans |
| dialog.input | fontWeight | 400 | 450 |
| dialog.input | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.input | borderTopWidth | 0px | 1px |
| dialog.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.input | borderRightWidth | 0px | 1px |
| dialog.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.input | borderBottomWidth | 0px | 1px |
| dialog.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.input | borderLeftWidth | 0px | 1px |
| dialog.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.input | borderTopLeftRadius | 0px | 8px |
| dialog.input | borderTopRightRadius | 0px | 8px |
| dialog.input | borderBottomRightRadius | 0px | 8px |
| dialog.input | borderBottomLeftRadius | 0px | 8px |
| dialog.input | outlineWidth | 2.4px | 3px |
| dialog.input | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.input | outlineOffset | 1.6px | 0px |
| dialog.input | paddingTop | 0px | 4px |
| dialog.input | paddingRight | 0px | 10px |
| dialog.input | paddingBottom | 0px | 4px |
| dialog.input | paddingLeft | 0px | 10px |
| dialog.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.input | transitionDuration | 0s | 0.15s |
| dialog.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.navitem | presence | 12 | absent |
| dialog.radiogroup | presence | 1 | absent |
| dialog.select | count, size | 8, 192.6x28 | 1, 89.8x32 |
| dialog.select | fontFamily | anthropic-sans | instrumentSans |
| dialog.select | fontWeight | 435 | 450 |
| dialog.select | whiteSpace | normal | nowrap |
| dialog.select | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.select | backgroundColor | rgba(0, 0, 0, 0) | rgb(253, 253, 251) |
| dialog.select | borderTopWidth | 0px | 1px |
| dialog.select | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderRightWidth | 0px | 1px |
| dialog.select | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderBottomWidth | 0px | 1px |
| dialog.select | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderLeftWidth | 0px | 1px |
| dialog.select | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderTopLeftRadius | 0px | 8px |
| dialog.select | borderTopRightRadius | 0px | 8px |
| dialog.select | borderBottomRightRadius | 0px | 8px |
| dialog.select | borderBottomLeftRadius | 0px | 8px |
| dialog.select | boxShadow | none | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px |
| dialog.select | outlineWidth | 1.6px | 3px |
| dialog.select | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| project.card | presence | absent | 4 |
| shell.header | count, size | 1, 1152x45 | 1, 152x16 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingTop | 0px | 4px |
| shell.header | paddingRight | 0px | 16px |
| shell.header | paddingBottom | 0px | 12px |
| shell.header | paddingLeft | 0px | 16px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.main | presence | 1 | absent |
| shell.sidebar | count, size | 1, 288x900 | 1, 152x240 |
| shell.sidebar | position | absolute | fixed |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(253, 253, 251) |
| shell.sidebar | opacity | 1 | 0 |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderTopLeftRadius | 0px | 18px |
| shell.sidebar | borderTopRightRadius | 0px | 18px |
| shell.sidebar | borderBottomRightRadius | 0px | 18px |
| shell.sidebar | borderBottomLeftRadius | 0px | 18px |
| shell.sidebar | boxShadow | none | rgb(220, 223, 215) 0px 0px 0px 1px inset, rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29 |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | maxWidth | none | 1424px |
| shell.sidebar | transitionProperty | all | none |
| shell.sidebar | transitionDuration | 0s | 0.2s |
| shell.sidebar | transitionTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| shell.sidebar | animationName | none | exit |
| shell.sidebar | animationDuration | 0s | 0.2s |
| shell.sidebar | animationTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| sidebar.footer | presence | 19 | absent |
| sidebar.navrow | presence | 5 | absent |
| sidebar.row | presence | 14 | absent |
| sidebar.row.fill | presence | 1 | absent |
| sidebar.section | presence | 21 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 2) | anthropic-sans x82<br>Anthropicons-Variable x65<br>anthropic-serif x3<br>anthropic-sans-display x1 | instrumentSans x49<br>sourceSerif4 x1 |
| fontSize (8 vs 7) | 14px x66<br>20px x52<br>12px x14<br>16px x12<br>15px x4<br>32px x1<br>22px x1<br>13px x1 | 14px x32<br>13px x7<br>12px x5<br>16px x2<br>17px x2<br>20px x1<br>15px x1 |
| fontWeight (8 vs 4) | 433.25 x51<br>435 x46<br>400 x32<br>533.25 x12<br>520 x6<br>577.75 x2<br>500 x1<br>360 x1 | 450 x34<br>500 x13<br>650 x2<br>600 x1 |
| lineHeight (8 vs 7) | 20px x96<br>21px x28<br>16px x12<br>12px x10<br>18px x2<br>38.4px x1<br>28px x1<br>17px x1 | 20px x32<br>18px x7<br>16px x5<br>22px x2<br>24px x2<br>26px x1<br>22.5px x1 |
| letterSpacing (1 vs 2) | normal x151 | normal x49<br>-0.35px x1 |
| color (4 vs 4) | rgba(0, 0, 0, 0.9) x116<br>rgba(0, 0, 0, 0.6) x33<br>rgb(16, 161, 34) x1<br>rgb(255, 255, 255) x1 | rgb(29, 35, 31) x20<br>rgb(75, 83, 77) x17<br>rgb(95, 102, 95) x11<br>rgb(244, 246, 241) x2 |
| backgroundColor (11 vs 9) | rgb(255, 255, 255) x8<br>rgba(255, 255, 255, 0.5) x5<br>hsl(none 0% 4.31373% / 0.05) x2<br>rgba(0, 0, 0, 0.1) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgb(198, 97, 63) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgb(25, 25, 25) x1 | rgb(253, 253, 251) x15<br>rgb(204, 208, 199) x3<br>rgb(255, 255, 255) x3<br>rgb(230, 231, 225) x2<br>rgb(35, 49, 39) x2<br>rgba(0, 0, 0, 0.6) x1<br>rgb(246, 246, 242) x1<br>rgb(210, 214, 204) x1<br>rgb(236, 238, 232) x1 |
| borderTopLeftRadius (7 vs 5) | 8px x112<br>6px x59<br>7px x6<br>5px x2<br>2.68435e+07px x2<br>14px x1<br>12px x1 | 8px x22<br>14px x14<br>3.35544e+07px x10<br>6px x1<br>18px x1 |
| boxShadow (4 vs 9) | rgba(0, 0, 0, 0.08) 0px 0px 0px 1px inset x5<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.0 x1 | rgb(220, 223, 215) 0px 0px 0px 1px x4<br>rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x3<br>rgb(220, 223, 215) 0px 0px 0px 1px, rgba(29, 35, 31, 0.08) 0 x1<br>rgb(220, 223, 215) 0px 0px 0px 1px inset x1<br>oklab(0.2486 -0.0105006 0.00462133 / 0.08) 0px 0px 0px 1px x1<br>rgba(29, 35, 31, 0.06) 0px 1px 2px 0px x1<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgb(220, 223, 215) 0px 0px 0px 1px inset, rgba(29, 35, 31, 0 x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (3 vs 3) | hsl(none 0% 4.31373% / 0.05) x7<br>hsl(none 0% 4.31373% / 0.1) x2<br>rgba(0, 0, 0, 0.08) x2 | rgba(0, 0, 0, 0) x4<br>rgb(204, 208, 199) x2<br>rgb(220, 223, 215) x1 |
| borderTopWidth (1 vs 1) | 0.8px x11 | 1px x7 |
| paddingTop (7 vs 8) | 12px x10<br>8px x7<br>4px x5<br>16px x4<br>1px x2<br>3.5px x2<br>297.1px x1 | 12px x6<br>4px x5<br>16px x5<br>6px x4<br>2px x3<br>8px x1<br>24px x1<br>14px x1 |
| paddingLeft (10 vs 9) | 8px x46<br>2px x23<br>10px x7<br>4px x4<br>16px x4<br>1px x3<br>12px x2<br>296px x1<br>56px x1<br>6px x1 | 10px x20<br>16px x14<br>2px x6<br>12px x5<br>8px x1<br>6px x1<br>4px x1<br>24px x1<br>14px x1 |
| rowGap (11 vs 9) | 4px x72<br>6px x56<br>2px x22<br>12px x16<br>28px x11<br>8px x8<br>1px x3<br>1.8px x2<br>5px x2<br>16px x2<br>24px x1 | 10px x14<br>12px x11<br>16px x10<br>8px x5<br>6px x5<br>1px x4<br>4px x3<br>2px x2<br>24px x1 |
| columnGap (10 vs 9) | 4px x72<br>6px x56<br>2px x22<br>12px x16<br>28px x11<br>8px x6<br>1.8px x2<br>5px x2<br>16px x2<br>24px x1 | 10px x14<br>12px x11<br>16px x10<br>8px x5<br>6px x5<br>1px x4<br>4px x3<br>2px x2<br>24px x1 |
| transitionDuration (8 vs 2) | 0.06s x83<br>0.45s x30<br>0.15s x9<br>0.2s x7<br>0.12s x3<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x26<br>0.2s x1 |
| transitionTimingFunction (6 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x65<br>cubic-bezier(0.165, 0.84, 0.44, 1) x38<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x30<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x26<br>cubic-bezier(0.32, 0.72, 0, 1) x1 |
| animationName (3 vs 1) | static-composer-actions-fade-in x6<br>task-grid-fade-in, task-grid-clip-reveal x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1 | exit x1 |
| strokeWidth (2 vs 1) | 1.25px x2<br>1px x1 | 1.75px x25 |

root custom properties: claude.ai 1383, cairn 72

## settings / nav-page-1

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 700 vs 230

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 28x28 | 2, 520x32 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0.15s |
| button.primary | cursor | pointer | default |
| composer.box | count, size | 1, 656x116 | 1, 139.2x34.4 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.22) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 2, 11.2x11.2 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | rowGap | 6px | normal |
| composer.button | columnGap | 6px | normal |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.input | count, size | 1, 632x63 | 1, 128x14.4 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | presence | 1 | absent |
| dialog | count, size | 1, 1024x800 | 3, 1216x852 |
| dialog | display | grid | flex |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 400 | 450 |
| dialog | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog | backgroundColor | rgb(255, 255, 255) | rgb(246, 246, 242) |
| dialog | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderTopLeftRadius | 12px | 14px |
| dialog | borderTopRightRadius | 12px | 14px |
| dialog | borderBottomRightRadius | 12px | 14px |
| dialog | borderBottomLeftRadius | 12px | 14px |
| dialog | boxShadow | rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.08) 0px 0px 0px 1px, hsl(none 0 | rgb(220, 223, 215) 0px 0px 0px 1px, rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29, 35,  |
| dialog | outlineWidth | 2.4px | 3px |
| dialog | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| dialog | marginTop | 50px | 0px |
| dialog | marginRight | 208px | 0px |
| dialog | marginBottom | 50px | 0px |
| dialog | marginLeft | 208px | 0px |
| dialog | maxWidth | 1024px | none |
| dialog | transitionProperty | opacity, scale | all |
| dialog | transitionDuration | 0.2s | 0s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | ease |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.4)","color":"rgba(0, 0, 0, 0.9)","radius":"12px"," | null |
| dialog.input | count, size | 1, 131.2x20 | 1, 520x32 |
| dialog.input | fontFamily | anthropic-sans | instrumentSans |
| dialog.input | fontWeight | 400 | 450 |
| dialog.input | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.input | borderTopWidth | 0px | 1px |
| dialog.input | borderTopColor | rgba(0, 0, 0, 0.9) | rgb(204, 208, 199) |
| dialog.input | borderRightWidth | 0px | 1px |
| dialog.input | borderRightColor | rgba(0, 0, 0, 0.9) | rgb(204, 208, 199) |
| dialog.input | borderBottomWidth | 0px | 1px |
| dialog.input | borderBottomColor | rgba(0, 0, 0, 0.9) | rgb(204, 208, 199) |
| dialog.input | borderLeftWidth | 0px | 1px |
| dialog.input | borderLeftColor | rgba(0, 0, 0, 0.9) | rgb(204, 208, 199) |
| dialog.input | borderTopLeftRadius | 0px | 8px |
| dialog.input | borderTopRightRadius | 0px | 8px |
| dialog.input | borderBottomRightRadius | 0px | 8px |
| dialog.input | borderBottomLeftRadius | 0px | 8px |
| dialog.input | outlineWidth | 2.4px | 3px |
| dialog.input | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.input | outlineOffset | 1.6px | 0px |
| dialog.input | paddingTop | 0px | 4px |
| dialog.input | paddingRight | 0px | 10px |
| dialog.input | paddingBottom | 0px | 4px |
| dialog.input | paddingLeft | 0px | 10px |
| dialog.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.input | transitionDuration | 0s | 0.15s |
| dialog.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.navitem | presence | 12 | absent |
| dialog.select | presence | absent | 1 |
| dialog.switch | count, size | 10, 36x20 | 3, 36x20 |
| dialog.switch | fontFamily | anthropic-sans | instrumentSans |
| dialog.switch | fontWeight | 400 | 450 |
| dialog.switch | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.switch | backgroundColor | rgb(37, 125, 224) | rgb(204, 208, 199) |
| dialog.switch | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| dialog.switch | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| dialog.switch | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| dialog.switch | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| dialog.switch | borderTopLeftRadius | 2.68435e+07px | 3.35544e+07px |
| dialog.switch | borderTopRightRadius | 2.68435e+07px | 3.35544e+07px |
| dialog.switch | borderBottomRightRadius | 2.68435e+07px | 3.35544e+07px |
| dialog.switch | borderBottomLeftRadius | 2.68435e+07px | 3.35544e+07px |
| dialog.switch | outlineWidth | 2.4px | 3px |
| dialog.switch | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| dialog.switch | paddingTop | 2px | 0px |
| dialog.switch | paddingBottom | 2px | 0px |
| dialog.switch | transitionDuration | 0s | 0.15s |
| dialog.switch | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.switch | cursor | pointer | auto |
| dialog.switch | ::after | null | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgb(29, 35, 31)","radius":"0px","opacit |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| project.card | presence | absent | 4 |
| shell.header | count, size | 1, 1152x45 | 1, 152x16 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingTop | 0px | 4px |
| shell.header | paddingRight | 0px | 16px |
| shell.header | paddingBottom | 0px | 12px |
| shell.header | paddingLeft | 0px | 16px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.main | presence | 1 | absent |
| shell.sidebar | count, size | 1, 288x900 | 1, 152x240 |
| shell.sidebar | position | absolute | fixed |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(253, 253, 251) |
| shell.sidebar | opacity | 1 | 0 |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderTopLeftRadius | 0px | 18px |
| shell.sidebar | borderTopRightRadius | 0px | 18px |
| shell.sidebar | borderBottomRightRadius | 0px | 18px |
| shell.sidebar | borderBottomLeftRadius | 0px | 18px |
| shell.sidebar | boxShadow | none | rgb(220, 223, 215) 0px 0px 0px 1px inset, rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29 |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | maxWidth | none | 1424px |
| shell.sidebar | transitionProperty | all | none |
| shell.sidebar | transitionDuration | 0s | 0.2s |
| shell.sidebar | transitionTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| shell.sidebar | animationName | none | exit |
| shell.sidebar | animationDuration | 0s | 0.2s |
| shell.sidebar | animationTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| sidebar.footer | presence | 19 | absent |
| sidebar.navrow | presence | 5 | absent |
| sidebar.row | presence | 14 | absent |
| sidebar.row.fill | presence | 1 | absent |
| sidebar.section | presence | 21 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 2) | anthropic-sans x82<br>Anthropicons-Variable x54<br>anthropic-serif x2<br>anthropic-sans-display x1 | instrumentSans x49<br>sourceSerif4 x1 |
| fontSize (8 vs 7) | 14px x65<br>20px x49<br>12px x14<br>16px x4<br>15px x4<br>32px x1<br>22px x1<br>13px x1 | 14px x32<br>13px x7<br>12px x5<br>16px x2<br>17px x2<br>20px x1<br>15px x1 |
| fontWeight (8 vs 4) | 433.25 x48<br>400 x39<br>435 x38<br>520 x6<br>533.25 x4<br>577.75 x2<br>500 x1<br>360 x1 | 450 x34<br>500 x13<br>650 x2<br>600 x1 |
| lineHeight (8 vs 7) | 20px x92<br>21px x28<br>12px x10<br>16px x4<br>18px x2<br>38.4px x1<br>28px x1<br>17px x1 | 20px x32<br>18px x7<br>16px x5<br>22px x2<br>24px x2<br>26px x1<br>22.5px x1 |
| letterSpacing (1 vs 2) | normal x139 | normal x49<br>-0.35px x1 |
| color (4 vs 4) | rgba(0, 0, 0, 0.9) x104<br>rgba(0, 0, 0, 0.6) x33<br>rgb(16, 161, 34) x1<br>rgb(255, 255, 255) x1 | rgb(29, 35, 31) x20<br>rgb(75, 83, 77) x17<br>rgb(95, 102, 95) x11<br>rgb(244, 246, 241) x2 |
| backgroundColor (11 vs 9) | rgb(255, 255, 255) x16<br>rgb(37, 125, 224) x10<br>rgba(0, 0, 0, 0.1) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>hsl(none 0% 4.31373% / 0.1) x1<br>hsl(none 0% 100%) x1<br>rgb(198, 97, 63) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgba(255, 255, 255, 0.5) x1<br>hsl(none 0% 4.31373% / 0.2) x1 | rgb(253, 253, 251) x15<br>rgb(204, 208, 199) x3<br>rgb(255, 255, 255) x3<br>rgb(230, 231, 225) x2<br>rgb(35, 49, 39) x2<br>rgba(0, 0, 0, 0.6) x1<br>rgb(246, 246, 242) x1<br>rgb(210, 214, 204) x1<br>rgb(236, 238, 232) x1 |
| borderTopLeftRadius (7 vs 5) | 8px x99<br>6px x56<br>2.68435e+07px x22<br>7px x5<br>5px x2<br>14px x1<br>12px x1 | 8px x22<br>14px x14<br>3.35544e+07px x10<br>6px x1<br>18px x1 |
| boxShadow (5 vs 9) | hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x10<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.0 x1<br>rgba(0, 0, 0, 0.08) 0px 0px 0px 1px inset x1 | rgb(220, 223, 215) 0px 0px 0px 1px x4<br>rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x3<br>rgb(220, 223, 215) 0px 0px 0px 1px, rgba(29, 35, 31, 0.08) 0 x1<br>rgb(220, 223, 215) 0px 0px 0px 1px inset x1<br>oklab(0.2486 -0.0105006 0.00462133 / 0.08) 0px 0px 0px 1px x1<br>rgba(29, 35, 31, 0.06) 0px 1px 2px 0px x1<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgb(220, 223, 215) 0px 0px 0px 1px inset, rgba(29, 35, 31, 0 x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (2 vs 3) | hsl(none 0% 4.31373% / 0.05) x8<br>hsl(none 0% 4.31373% / 0.1) x2 | rgba(0, 0, 0, 0) x4<br>rgb(204, 208, 199) x2<br>rgb(220, 223, 215) x1 |
| borderTopWidth (1 vs 1) | 0.8px x10 | 1px x7 |
| paddingTop (8 vs 8) | 12px x11<br>2px x10<br>8px x7<br>4px x5<br>16px x4<br>3.5px x2<br>1px x1<br>297.1px x1 | 12px x6<br>4px x5<br>16px x5<br>6px x4<br>2px x3<br>8px x1<br>24px x1<br>14px x1 |
| paddingLeft (10 vs 9) | 8px x38<br>2px x33<br>10px x7<br>4px x4<br>16px x4<br>1px x2<br>296px x1<br>56px x1<br>6px x1<br>12px x1 | 10px x20<br>16px x14<br>2px x6<br>12px x5<br>8px x1<br>6px x1<br>4px x1<br>24px x1<br>14px x1 |
| rowGap (11 vs 9) | 4px x74<br>6px x37<br>2px x22<br>12px x14<br>28px x13<br>8px x8<br>1px x3<br>1.8px x2<br>5px x2<br>24px x1<br>16px x1 | 10px x14<br>12px x11<br>16px x10<br>8px x5<br>6px x5<br>1px x4<br>4px x3<br>2px x2<br>24px x1 |
| columnGap (10 vs 9) | 4px x74<br>6px x37<br>2px x22<br>12px x14<br>28px x13<br>8px x6<br>1.8px x2<br>5px x2<br>24px x1<br>16px x1 | 10px x14<br>12px x11<br>16px x10<br>8px x5<br>6px x5<br>1px x4<br>4px x3<br>2px x2<br>24px x1 |
| transitionDuration (8 vs 2) | 0.06s x71<br>0.45s x30<br>0.12s x13<br>0.2s x7<br>0.28s x2<br>0.5s x1<br>0.15s x1<br>0.12s, 0s x1 | 0.15s x26<br>0.2s x1 |
| transitionTimingFunction (7 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x45<br>cubic-bezier(0.165, 0.84, 0.44, 1) x38<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x30<br>cubic-bezier(0.34, 1.3, 0.64, 1) x10<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x26<br>cubic-bezier(0.32, 0.72, 0, 1) x1 |
| animationName (3 vs 1) | static-composer-actions-fade-in x6<br>task-grid-fade-in, task-grid-clip-reveal x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1 | exit x1 |
| strokeWidth (2 vs 1) | 1.25px x2<br>1px x1 | 1.75px x25 |

root custom properties: claude.ai 1383, cairn 72

## settings / nav-page-2

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 719 vs 191

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 16, 28x28 | 1, 30.8x12.8 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| composer.box | count, size | 1, 656x116 | 1, 139.2x34.4 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.22) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 2, 11.2x11.2 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | rowGap | 6px | normal |
| composer.button | columnGap | 6px | normal |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.input | count, size | 1, 632x63 | 1, 128x14.4 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | presence | 1 | absent |
| dialog | count, size | 1, 1024x800 | 3, 1216x852 |
| dialog | display | grid | flex |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 400 | 450 |
| dialog | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog | backgroundColor | rgb(255, 255, 255) | rgb(246, 246, 242) |
| dialog | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderTopLeftRadius | 12px | 14px |
| dialog | borderTopRightRadius | 12px | 14px |
| dialog | borderBottomRightRadius | 12px | 14px |
| dialog | borderBottomLeftRadius | 12px | 14px |
| dialog | boxShadow | rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.08) 0px 0px 0px 1px, hsl(none 0 | rgb(220, 223, 215) 0px 0px 0px 1px, rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29, 35,  |
| dialog | outlineWidth | 2.4px | 3px |
| dialog | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| dialog | marginTop | 50px | 0px |
| dialog | marginRight | 208px | 0px |
| dialog | marginBottom | 50px | 0px |
| dialog | marginLeft | 208px | 0px |
| dialog | maxWidth | 1024px | none |
| dialog | transitionProperty | opacity, scale | all |
| dialog | transitionDuration | 0.2s | 0s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | ease |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.4)","color":"rgba(0, 0, 0, 0.9)","radius":"12px"," | null |
| dialog.input | presence | 1 | absent |
| dialog.navitem | presence | 12 | absent |
| dialog.select | presence | 3 | absent |
| dialog.switch | count, size | 5, 36x20 | 1, 36x20 |
| dialog.switch | fontFamily | anthropic-sans | instrumentSans |
| dialog.switch | fontWeight | 400 | 450 |
| dialog.switch | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.switch | backgroundColor | rgb(37, 125, 224) | rgb(204, 208, 199) |
| dialog.switch | opacity | 0.4 | 0.5 |
| dialog.switch | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| dialog.switch | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| dialog.switch | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| dialog.switch | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| dialog.switch | borderTopLeftRadius | 2.68435e+07px | 3.35544e+07px |
| dialog.switch | borderTopRightRadius | 2.68435e+07px | 3.35544e+07px |
| dialog.switch | borderBottomRightRadius | 2.68435e+07px | 3.35544e+07px |
| dialog.switch | borderBottomLeftRadius | 2.68435e+07px | 3.35544e+07px |
| dialog.switch | outlineWidth | 2.4px | 3px |
| dialog.switch | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| dialog.switch | paddingTop | 2px | 0px |
| dialog.switch | paddingBottom | 2px | 0px |
| dialog.switch | transitionDuration | 0s | 0.15s |
| dialog.switch | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.switch | cursor | default | not-allowed |
| dialog.switch | ::after | null | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgb(29, 35, 31)","radius":"0px","opacit |
| home.greeting | presence | 1 | absent |
| jump | presence | absent | 1 |
| shell.header | count, size | 1, 1152x45 | 1, 152x16 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingTop | 0px | 4px |
| shell.header | paddingRight | 0px | 16px |
| shell.header | paddingBottom | 0px | 12px |
| shell.header | paddingLeft | 0px | 16px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.main | presence | 2 | absent |
| shell.sidebar | count, size | 1, 288x900 | 1, 152x240 |
| shell.sidebar | position | absolute | fixed |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(253, 253, 251) |
| shell.sidebar | opacity | 1 | 0 |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderTopLeftRadius | 0px | 18px |
| shell.sidebar | borderTopRightRadius | 0px | 18px |
| shell.sidebar | borderBottomRightRadius | 0px | 18px |
| shell.sidebar | borderBottomLeftRadius | 0px | 18px |
| shell.sidebar | boxShadow | none | rgb(220, 223, 215) 0px 0px 0px 1px inset, rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29 |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | maxWidth | none | 1424px |
| shell.sidebar | transitionProperty | all | none |
| shell.sidebar | transitionDuration | 0s | 0.2s |
| shell.sidebar | transitionTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| shell.sidebar | animationName | none | exit |
| shell.sidebar | animationDuration | 0s | 0.2s |
| shell.sidebar | animationTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| sidebar.footer | presence | 19 | absent |
| sidebar.navrow | presence | 5 | absent |
| sidebar.row | presence | 14 | absent |
| sidebar.row.fill | presence | 1 | absent |
| sidebar.section | presence | 21 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 1) | anthropic-sans x86<br>Anthropicons-Variable x56<br>anthropic-serif x2<br>anthropic-sans-display x1 | instrumentSans x37 |
| fontSize (8 vs 5) | 14px x69<br>20px x49<br>12px x14<br>16px x6<br>15px x4<br>32px x1<br>22px x1<br>13px x1 | 14px x20<br>13px x8<br>12px x5<br>15px x2<br>17px x2 |
| fontWeight (8 vs 4) | 433.25 x48<br>435 x43<br>400 x38<br>520 x6<br>533.25 x6<br>577.75 x2<br>500 x1<br>360 x1 | 450 x25<br>500 x9<br>650 x2<br>600 x1 |
| lineHeight (8 vs 5) | 20px x96<br>21px x28<br>12px x10<br>16px x6<br>18px x2<br>38.4px x1<br>28px x1<br>17px x1 | 20px x20<br>18px x8<br>16px x5<br>22.5px x2<br>24px x2 |
| letterSpacing (1 vs 1) | normal x145 | normal x37 |
| color (6 vs 5) | rgba(0, 0, 0, 0.9) x108<br>rgba(0, 0, 0, 0.6) x33<br>rgb(16, 161, 34) x1<br>rgb(255, 255, 255) x1<br>rgb(23, 87, 172) x1<br>rgb(135, 135, 135) x1 | rgb(75, 83, 77) x15<br>rgb(29, 35, 31) x10<br>rgb(95, 102, 95) x9<br>rgb(168, 174, 166) x2<br>rgb(244, 246, 241) x1 |
| backgroundColor (12 vs 10) | rgb(255, 255, 255) x11<br>rgb(37, 125, 224) x5<br>rgba(0, 0, 0, 0.1) x2<br>rgba(0, 0, 0, 0.05) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>hsl(none 0% 4.31373% / 0.1) x1<br>hsl(none 0% 100%) x1<br>rgb(198, 97, 63) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgba(255, 255, 255, 0.5) x1<br>hsl(none 0% 4.31373% / 0.2) x1 | rgb(253, 253, 251) x9<br>rgb(230, 231, 225) x2<br>rgba(0, 0, 0, 0.6) x1<br>rgb(246, 246, 242) x1<br>rgb(210, 214, 204) x1<br>rgb(168, 174, 166) x1<br>rgb(204, 208, 199) x1<br>rgb(255, 255, 255) x1<br>rgb(35, 49, 39) x1<br>rgb(236, 238, 232) x1 |
| borderTopLeftRadius (8 vs 5) | 8px x108<br>6px x56<br>2.68435e+07px x12<br>7px x5<br>5px x2<br>14px x1<br>12px x1<br>2px x1 | 8px x20<br>14px x8<br>6px x4<br>3.35544e+07px x4<br>18px x1 |
| boxShadow (5 vs 6) | hsl(none 0% 4.31373% / 0.06) 0px 1px 2px 0px, hsl(none 0% 4. x5<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.0 x1<br>rgba(0, 0, 0, 0.08) 0px 0px 0px 1px inset x1 | rgb(220, 223, 215) 0px 0px 0px 1px x2<br>rgb(220, 223, 215) 0px 0px 0px 1px, rgba(29, 35, 31, 0.08) 0 x1<br>rgb(220, 223, 215) 0px 0px 0px 1px inset x1<br>rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x1<br>rgb(220, 223, 215) 0px 0px 0px 1px inset, rgba(29, 35, 31, 0 x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (2 vs 1) | hsl(none 0% 4.31373% / 0.05) x6<br>hsl(none 0% 4.31373% / 0.1) x2 | rgba(0, 0, 0, 0) x8 |
| borderTopWidth (1 vs 1) | 0.8px x8 | 1px x8 |
| paddingTop (8 vs 6) | 12px x9<br>8px x8<br>4px x5<br>2px x5<br>16px x4<br>3.5px x2<br>1px x1<br>297.1px x1 | 12px x6<br>4px x4<br>2px x3<br>16px x2<br>10px x1<br>14px x1 |
| paddingLeft (12 vs 9) | 8px x41<br>2px x28<br>10px x7<br>4px x4<br>16px x4<br>1px x2<br>9px x2<br>296px x1<br>56px x1<br>6px x1<br>12px x1<br>24px x1 | 10px x17<br>16px x7<br>2px x4<br>12px x4<br>8px x1<br>6px x1<br>24px x1<br>20px x1<br>14px x1 |
| rowGap (11 vs 8) | 4px x76<br>6px x46<br>2px x22<br>12px x14<br>28px x13<br>8px x10<br>1px x3<br>16px x3<br>1.8px x2<br>5px x2<br>24px x1 | 10px x14<br>12px x10<br>1px x4<br>6px x4<br>8px x2<br>4px x2<br>2px x2<br>16px x1 |
| columnGap (10 vs 8) | 4px x76<br>6px x46<br>2px x22<br>12px x14<br>28px x13<br>8px x8<br>16px x3<br>1.8px x2<br>5px x2<br>24px x1 | 10px x14<br>12px x10<br>6px x5<br>1px x4<br>8px x2<br>4px x2<br>2px x2<br>16px x1 |
| transitionDuration (8 vs 2) | 0.06s x79<br>0.45s x32<br>0.12s x8<br>0.2s x7<br>0.15s x3<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x24<br>0.2s x1 |
| transitionTimingFunction (7 vs 2) | cubic-bezier(0.4, 0, 0.2, 1) x52<br>cubic-bezier(0.165, 0.84, 0.44, 1) x41<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x32<br>cubic-bezier(0.34, 1.3, 0.64, 1) x5<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x24<br>cubic-bezier(0.32, 0.72, 0, 1) x1 |
| animationName (2 vs 1) | task-grid-fade-in, task-grid-clip-reveal x1<br>cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x1 | exit x1 |
| strokeWidth (2 vs 1) | 1.25px x2<br>1px x1 | 1.75px x26 |

root custom properties: claude.ai 1383, cairn 72

## settings / open-select

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 740 vs 243

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 11, 28x28 | 2, 520x32 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0.15s |
| button.primary | cursor | pointer | default |
| composer.box | count, size | 1, 656x116 | 1, 139.2x34.4 |
| composer.box | display | flex | block |
| composer.box | position | relative | static |
| composer.box | fontFamily | anthropic-sans | instrumentSans |
| composer.box | fontWeight | 400 | 450 |
| composer.box | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| composer.box | backgroundColor | rgb(255, 255, 255) | rgb(253, 253, 251) |
| composer.box | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| composer.box | boxShadow | color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px inset, rgb | rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0.137255 0.121569 / 0.22) 0px 0p |
| composer.box | outlineWidth | 2.4px | 3px |
| composer.box | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| composer.button | count, size | 3, 28x28 | 2, 11.2x11.2 |
| composer.button | position | relative | static |
| composer.button | fontFamily | anthropic-sans | instrumentSans |
| composer.button | fontWeight | 435 | 500 |
| composer.button | color | rgba(0, 0, 0, 0.9) | rgb(95, 102, 95) |
| composer.button | borderTopWidth | 0px | 1px |
| composer.button | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderRightWidth | 0px | 1px |
| composer.button | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderBottomWidth | 0px | 1px |
| composer.button | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | borderLeftWidth | 0px | 1px |
| composer.button | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| composer.button | outlineWidth | 1.6px | 3px |
| composer.button | outlineColor | rgba(35, 112, 205, 0) | rgb(95, 102, 95) |
| composer.button | outlineOffset | 1.6px | 0px |
| composer.button | rowGap | 6px | normal |
| composer.button | columnGap | 6px | normal |
| composer.button | transitionProperty | box-shadow | all |
| composer.button | transitionDuration | 0.06s | 0s |
| composer.input | count, size | 1, 632x63 | 1, 128x14.4 |
| composer.input | display | block | flex |
| composer.input | fontFamily | anthropic-sans | instrumentSans |
| composer.input | fontWeight | 400 | 450 |
| composer.input | lineHeight | 21px | 22.5px |
| composer.input | whiteSpace | break-spaces | pre-wrap |
| composer.input | color | rgba(0, 0, 0, 0.9) | rgba(0, 0, 0, 0) |
| composer.input | borderTopStyle | solid | none |
| composer.input | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderRightStyle | solid | none |
| composer.input | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderBottomStyle | solid | none |
| composer.input | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | borderLeftStyle | solid | none |
| composer.input | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| composer.input | outlineWidth | 2.4px | 3px |
| composer.input | outlineColor | rgb(35, 112, 205) | rgba(0, 0, 0, 0) |
| composer.input | paddingTop | 0px | 2px |
| composer.input | paddingRight | 0px | 2px |
| composer.input | paddingBottom | 0px | 10px |
| composer.input | paddingLeft | 0px | 2px |
| composer.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| composer.input | transitionDuration | 0s | 0.15s |
| composer.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| composer.model | presence | 1 | absent |
| dialog | count, size | 2, 1024x800 | 3, 1216x852 |
| dialog | display | grid | flex |
| dialog | fontFamily | anthropic-sans | instrumentSans |
| dialog | fontWeight | 400 | 450 |
| dialog | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog | backgroundColor | rgb(255, 255, 255) | rgb(246, 246, 242) |
| dialog | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| dialog | borderTopLeftRadius | 12px | 14px |
| dialog | borderTopRightRadius | 12px | 14px |
| dialog | borderBottomRightRadius | 12px | 14px |
| dialog | borderBottomLeftRadius | 12px | 14px |
| dialog | boxShadow | rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.08) 0px 0px 0px 1px, hsl(none 0 | rgb(220, 223, 215) 0px 0px 0px 1px, rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29, 35,  |
| dialog | outlineWidth | 2.4px | 3px |
| dialog | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| dialog | marginTop | 50px | 0px |
| dialog | marginRight | 208px | 0px |
| dialog | marginBottom | 50px | 0px |
| dialog | marginLeft | 208px | 0px |
| dialog | maxWidth | 1024px | none |
| dialog | transitionProperty | opacity, scale | all |
| dialog | transitionDuration | 0.2s | 0s |
| dialog | transitionTimingFunction | cubic-bezier(0.165, 0.84, 0.44, 1) | ease |
| dialog | ::after | {"content":"\"\"","bg":"rgba(0, 0, 0, 0.4)","color":"rgba(0, 0, 0, 0.9)","radius":"12px"," | null |
| dialog.input | count, size | 2, 131.2x20 | 1, 520x32 |
| dialog.input | fontFamily | anthropic-sans | instrumentSans |
| dialog.input | fontWeight | 400 | 450 |
| dialog.input | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.input | borderTopWidth | 0px | 1px |
| dialog.input | borderTopColor | rgba(0, 0, 0, 0.9) | rgb(204, 208, 199) |
| dialog.input | borderRightWidth | 0px | 1px |
| dialog.input | borderRightColor | rgba(0, 0, 0, 0.9) | rgb(204, 208, 199) |
| dialog.input | borderBottomWidth | 0px | 1px |
| dialog.input | borderBottomColor | rgba(0, 0, 0, 0.9) | rgb(204, 208, 199) |
| dialog.input | borderLeftWidth | 0px | 1px |
| dialog.input | borderLeftColor | rgba(0, 0, 0, 0.9) | rgb(204, 208, 199) |
| dialog.input | borderTopLeftRadius | 0px | 8px |
| dialog.input | borderTopRightRadius | 0px | 8px |
| dialog.input | borderBottomRightRadius | 0px | 8px |
| dialog.input | borderBottomLeftRadius | 0px | 8px |
| dialog.input | outlineWidth | 2.4px | 3px |
| dialog.input | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.input | outlineOffset | 1.6px | 0px |
| dialog.input | paddingTop | 0px | 4px |
| dialog.input | paddingRight | 0px | 10px |
| dialog.input | paddingBottom | 0px | 4px |
| dialog.input | paddingLeft | 0px | 10px |
| dialog.input | transitionProperty | all | color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, |
| dialog.input | transitionDuration | 0s | 0.15s |
| dialog.input | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| dialog.navitem | presence | 12 | absent |
| dialog.radiogroup | presence | 1 | absent |
| dialog.select | count, size | 8, 192.6x28 | 1, 89.8x32 |
| dialog.select | fontFamily | anthropic-sans | instrumentSans |
| dialog.select | fontWeight | 435 | 450 |
| dialog.select | whiteSpace | normal | nowrap |
| dialog.select | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| dialog.select | backgroundColor | rgba(0, 0, 0, 0) | rgb(253, 253, 251) |
| dialog.select | borderTopWidth | 0px | 1px |
| dialog.select | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderRightWidth | 0px | 1px |
| dialog.select | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderBottomWidth | 0px | 1px |
| dialog.select | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderLeftWidth | 0px | 1px |
| dialog.select | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(204, 208, 199) |
| dialog.select | borderTopLeftRadius | 0px | 8px |
| dialog.select | borderTopRightRadius | 0px | 8px |
| dialog.select | borderBottomRightRadius | 0px | 8px |
| dialog.select | borderBottomLeftRadius | 0px | 8px |
| dialog.select | boxShadow | none | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px |
| dialog.select | outlineWidth | 1.6px | 3px |
| dialog.select | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| listbox | count, size | 1, 212x84 | 1, 136x64 |
| listbox | fontFamily | anthropic-sans | instrumentSans |
| listbox | fontWeight | 400 | 450 |
| listbox | lineHeight | 20px | 21px |
| listbox | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| listbox | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| listbox | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| listbox | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| listbox | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| listbox | outlineWidth | 2.4px | 3px |
| listbox | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| project.card | presence | absent | 4 |
| shell.header | count, size | 1, 1152x45 | 1, 152x16 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingTop | 0px | 4px |
| shell.header | paddingRight | 0px | 16px |
| shell.header | paddingBottom | 0px | 12px |
| shell.header | paddingLeft | 0px | 16px |
| shell.header | marginRight | -8px | 0px |
| shell.header | marginLeft | -8px | 0px |
| shell.main | presence | 1 | absent |
| shell.sidebar | count, size | 1, 288x900 | 1, 152x240 |
| shell.sidebar | position | absolute | fixed |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(253, 253, 251) |
| shell.sidebar | opacity | 1 | 0 |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderTopLeftRadius | 0px | 18px |
| shell.sidebar | borderTopRightRadius | 0px | 18px |
| shell.sidebar | borderBottomRightRadius | 0px | 18px |
| shell.sidebar | borderBottomLeftRadius | 0px | 18px |
| shell.sidebar | boxShadow | none | rgb(220, 223, 215) 0px 0px 0px 1px inset, rgba(29, 35, 31, 0.08) 0px 4px 12px 0px, rgba(29 |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | maxWidth | none | 1424px |
| shell.sidebar | transitionProperty | all | none |
| shell.sidebar | transitionDuration | 0s | 0.2s |
| shell.sidebar | transitionTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| shell.sidebar | animationName | none | exit |
| shell.sidebar | animationDuration | 0s | 0.2s |
| shell.sidebar | animationTimingFunction | ease | cubic-bezier(0.32, 0.72, 0, 1) |
| sidebar.footer | presence | 19 | absent |
| sidebar.navrow | presence | 5 | absent |
| sidebar.row | presence | 14 | absent |
| sidebar.row.fill | presence | 1 | absent |
| sidebar.section | presence | 21 | absent |

### Value sets on the page (catch-all)

| prop | claude.ai | cairn |
|---|---|---|
| fontFamily (4 vs 2) | anthropic-sans x85<br>Anthropicons-Variable x66<br>anthropic-serif x3<br>anthropic-sans-display x1 | instrumentSans x51<br>sourceSerif4 x1 |
| fontSize (8 vs 7) | 14px x69<br>20px x53<br>12px x14<br>16px x12<br>15px x4<br>32px x1<br>22px x1<br>13px x1 | 14px x34<br>13px x7<br>12px x5<br>16px x2<br>17px x2<br>20px x1<br>15px x1 |
| fontWeight (9 vs 4) | 433.25 x51<br>435 x49<br>400 x32<br>533.25 x12<br>520 x6<br>577.75 x2<br>500 x1<br>360 x1<br>566.5 x1 | 450 x36<br>500 x13<br>650 x2<br>600 x1 |
| lineHeight (8 vs 7) | 20px x100<br>21px x28<br>16px x12<br>12px x10<br>18px x2<br>38.4px x1<br>28px x1<br>17px x1 | 20px x34<br>18px x7<br>16px x5<br>22px x2<br>24px x2<br>26px x1<br>22.5px x1 |
| letterSpacing (1 vs 2) | normal x155 | normal x51<br>-0.35px x1 |
| color (5 vs 4) | rgba(0, 0, 0, 0.9) x119<br>rgba(0, 0, 0, 0.6) x33<br>rgb(16, 161, 34) x1<br>rgb(255, 255, 255) x1<br>rgb(23, 87, 172) x1 | rgb(29, 35, 31) x22<br>rgb(75, 83, 77) x17<br>rgb(95, 102, 95) x11<br>rgb(244, 246, 241) x2 |
| backgroundColor (11 vs 10) | rgb(255, 255, 255) x9<br>rgba(255, 255, 255, 0.5) x5<br>rgba(0, 0, 0, 0.1) x4<br>hsl(none 0% 4.31373% / 0.05) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgb(198, 97, 63) x1<br>rgba(0, 0, 0, 0.4) x1<br>rgb(25, 25, 25) x1 | rgb(253, 253, 251) x16<br>rgb(204, 208, 199) x3<br>rgb(255, 255, 255) x3<br>rgb(230, 231, 225) x2<br>rgb(35, 49, 39) x2<br>rgba(0, 0, 0, 0.6) x1<br>rgb(246, 246, 242) x1<br>rgb(210, 214, 204) x1<br>rgb(236, 238, 232) x1<br>rgba(29, 35, 31, 0.1) x1 |
| borderTopLeftRadius (7 vs 6) | 8px x115<br>6px x59<br>7px x6<br>14px x3<br>5px x2<br>2.68435e+07px x2<br>12px x1 | 8px x24<br>14px x14<br>3.35544e+07px x10<br>6px x1<br>18px x1<br>12px x1 |
| boxShadow (5 vs 10) | rgba(0, 0, 0, 0.08) 0px 0px 0px 1px inset x5<br>hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x2<br>color(srgb 0 0 0 / 0.035) 0px 4px 20px 0px, rgba(0, 0, 0, 0. x1<br>rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.0 x1<br>rgba(0, 0, 0, 0.08) 0px 0px 0px 0px inset, rgba(0, 0, 0, 0.0 x1 | rgb(220, 223, 215) 0px 0px 0px 1px x4<br>rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x3<br>rgb(220, 223, 215) 0px 0px 0px 1px, rgba(29, 35, 31, 0.08) 0 x1<br>rgb(220, 223, 215) 0px 0px 0px 1px inset x1<br>oklab(0.2486 -0.0105006 0.00462133 / 0.08) 0px 0px 0px 1px x1<br>rgba(29, 35, 31, 0.06) 0px 1px 2px 0px x1<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgb(220, 223, 215) 0px 0px 0px 1px inset, rgba(29, 35, 31, 0 x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1<br>rgba(29, 35, 31, 0.08) 0px 2px 6px 0px, rgba(29, 35, 31, 0.1 x1 |
| borderTopColor (3 vs 3) | hsl(none 0% 4.31373% / 0.05) x7<br>hsl(none 0% 4.31373% / 0.1) x2<br>rgba(0, 0, 0, 0.08) x2 | rgba(0, 0, 0, 0) x4<br>rgb(204, 208, 199) x2<br>rgb(220, 223, 215) x1 |
| borderTopWidth (1 vs 1) | 0.8px x11 | 1px x7 |
| paddingTop (8 vs 8) | 12px x10<br>4px x8<br>8px x7<br>16px x4<br>1px x2<br>3.5px x2<br>297.1px x1<br>6px x1 | 12px x6<br>4px x6<br>16px x5<br>6px x4<br>2px x3<br>8px x1<br>24px x1<br>14px x1 |
| paddingLeft (10 vs 9) | 8px x46<br>2px x23<br>10px x7<br>12px x5<br>4px x4<br>16px x4<br>1px x3<br>6px x2<br>296px x1<br>56px x1 | 10px x22<br>16px x14<br>2px x6<br>12px x5<br>4px x2<br>8px x1<br>6px x1<br>24px x1<br>14px x1 |
| rowGap (11 vs 9) | 4px x72<br>6px x56<br>2px x25<br>12px x16<br>8px x11<br>28px x11<br>1px x3<br>1.8px x2<br>5px x2<br>16px x2<br>24px x1 | 10px x16<br>12px x11<br>16px x10<br>8px x8<br>6px x5<br>1px x4<br>4px x3<br>2px x2<br>24px x1 |
| columnGap (10 vs 9) | 4px x72<br>6px x56<br>2px x25<br>12px x16<br>28px x11<br>8px x9<br>1.8px x2<br>5px x2<br>16px x2<br>24px x1 | 10px x16<br>12px x11<br>16px x10<br>8px x8<br>6px x5<br>1px x4<br>4px x3<br>2px x2<br>24px x1 |
| transitionDuration (8 vs 3) | 0.06s x86<br>0.45s x30<br>0.15s x9<br>0.2s x7<br>0.12s x3<br>0.28s x2<br>0.5s x1<br>0.12s, 0s x1 | 0.15s x26<br>0.2s x1<br>0.1s x1 |
| transitionTimingFunction (6 vs 3) | cubic-bezier(0.4, 0, 0.2, 1) x68<br>cubic-bezier(0.165, 0.84, 0.44, 1) x38<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x30<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1<br>ease-out, linear x1 | cubic-bezier(0.4, 0, 0.2, 1) x26<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease x1 |
| animationName (2 vs 2) | cds-scroll-fade-top, cds-scroll-fade-bottom, cds-scroll-fade x2<br>task-grid-fade-in, task-grid-clip-reveal x1 | exit x1<br>enter x1 |
| strokeWidth (2 vs 1) | 1.25px x2<br>1px x1 | 1.75px x26 |

root custom properties: claude.ai 1383, cairn 72

## projects / initial

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 494 vs 119

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 7, 28x28 | 2, 77x32 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | marginLeft | 0px | 341.016px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| composer.box | presence | absent | 1 |
| composer.button | presence | absent | 5 |
| composer.input | presence | absent | 1 |
| composer.model | presence | absent | 1 |
| home.greeting | count, size | 1, 92.2x32 | 1, 728x32 |
| home.greeting | fontFamily | anthropic-serif | sourceSerif4 |
| home.greeting | fontSize | 24px | 26px |
| home.greeting | fontWeight | 500 | 600 |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | whiteSpace | normal | nowrap |
| home.greeting | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| home.greeting | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| project.card | count, size | 3, 474x64 | 1, 728x38 |
| project.card | fontFamily | anthropic-sans | instrumentSans |
| project.card | fontWeight | 400 | 450 |
| project.card | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| project.card | backgroundColor | rgba(0, 0, 0, 0) | rgb(253, 253, 251) |
| project.card | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| project.card | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| project.card | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| project.card | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| project.card | borderTopLeftRadius | 12px | 14px |
| project.card | borderTopRightRadius | 12px | 14px |
| project.card | borderBottomRightRadius | 12px | 14px |
| project.card | borderBottomLeftRadius | 12px | 14px |
| project.card | boxShadow | none | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.06) 0px 2px 8px 0px, rgb(220, 2 |
| project.card | outlineWidth | 2.4px | 3px |
| project.card | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| shell.header | count, size | 1, 960x88 | 2, 1184x48 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingBottom | 24px | 0px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | rowGap | 16px | 2px |
| shell.header | columnGap | 16px | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 19, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (3 vs 2) | anthropic-sans x50<br>Anthropicons-Variable x42<br>anthropic-serif x2 | instrumentSans x24<br>sourceSerif4 x1 |
| fontSize (5 vs 6) | 20px x42<br>14px x31<br>12px x13<br>13px x7<br>24px x1 | 14px x8<br>12px x7<br>13px x7<br>20px x1<br>26px x1<br>15px x1 |
| fontWeight (6 vs 4) | 433.25 x41<br>400 x25<br>435 x23<br>500 x2<br>520 x2<br>577.75 x1 | 450 x10<br>500 x8<br>600 x6<br>650 x1 |
| lineHeight (6 vs 7) | 20px x48<br>21px x27<br>12px x9<br>17px x7<br>18px x2<br>32px x1 | 16px x7<br>20px x7<br>18px x7<br>26px x1<br>32px x1<br>21px x1<br>22.5px x1 |
| letterSpacing (1 vs 2) | normal x94 | normal x24<br>-0.26px x1 |
| color (6 vs 5) | rgba(0, 0, 0, 0.9) x67<br>rgba(0, 0, 0, 0.6) x22<br>rgb(16, 161, 34) x2<br>rgb(255, 255, 255) x1<br>rgb(174, 115, 3) x1<br>rgb(210, 95, 37) x1 | rgb(29, 35, 31) x11<br>rgb(75, 83, 77) x6<br>rgb(95, 102, 95) x5<br>rgb(244, 246, 241) x2<br>rgb(255, 255, 255) x1 |
| backgroundColor (12 vs 9) | rgb(255, 255, 255) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>hsl(none 0% 4.31373% / 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgb(25, 25, 25) x1<br>color(srgb 1 1 1 / 0.85) x1<br>oklab(0.616768 -0.158699 0.116515 / 0.1) x1<br>oklab(0.602709 0.0365174 0.122051 / 0.1) x1<br>oklab(0.61975 0.115669 0.111509 / 0.1) x1 | rgb(253, 253, 251) x5<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(35, 49, 39) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(236, 238, 232) x1 |
| borderTopLeftRadius (6 vs 3) | 8px x76<br>6px x56<br>12px x9<br>7px x2<br>5px x2<br>2.68435e+07px x2 | 8px x19<br>3.35544e+07px x5<br>14px x4 |
| boxShadow (1 vs 4) | hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgb(220, 223, 215) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (0 vs 2) |  | rgba(0, 0, 0, 0) x10<br>rgb(220, 223, 215) x1 |
| borderTopWidth (0 vs 1) |  | 1px x11 |
| paddingTop (4 vs 6) | 4px x6<br>16px x5<br>8px x2<br>1px x1 | 2px x3<br>12px x2<br>4px x1<br>8px x1<br>54px x1<br>6px x1 |
| paddingLeft (9 vs 10) | 2px x23<br>8px x18<br>4px x4<br>16px x3<br>10px x2<br>32px x2<br>1px x1<br>288px x1<br>9px x1 | 10px x5<br>8px x4<br>12px x3<br>2px x3<br>4px x2<br>9px x2<br>6px x1<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (8 vs 7) | 4px x55<br>6px x37<br>2px x24<br>12px x10<br>8px x6<br>1.8px x2<br>5px x2<br>16px x1 | 6px x8<br>2px x5<br>8px x5<br>1px x5<br>4px x3<br>10px x2<br>12px x1 |
| columnGap (8 vs 7) | 4px x55<br>6px x37<br>2px x24<br>12px x10<br>8px x6<br>1.8px x2<br>5px x2<br>16px x1 | 6px x8<br>2px x5<br>1px x5<br>8px x4<br>10px x3<br>4px x3<br>12px x1 |
| transitionDuration (6 vs 1) | 0.06s x59<br>0.45s x33<br>0.12s x2<br>0.5s x1<br>0.15s x1<br>0.2s x1 | 0.15s x10 |
| transitionTimingFunction (5 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x35<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x33<br>cubic-bezier(0.165, 0.84, 0.44, 1) x27<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (1 vs 0) | task-grid-fade-in, task-grid-clip-reveal x1 |  |
| strokeWidth (0 vs 2) |  | 1.75px x14<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72

## projects / hover-cards

viewport claude.ai 1440x900x1.0000000149011612, cairn 1440x900x1; elements 494 vs 119

| role | prop | claude.ai | cairn |
|---|---|---|---|
| button.primary | count, size | 7, 28x28 | 2, 77x32 |
| button.primary | position | relative | static |
| button.primary | fontFamily | anthropic-sans | instrumentSans |
| button.primary | fontWeight | 435 | 500 |
| button.primary | color | rgba(0, 0, 0, 0.9) | rgb(244, 246, 241) |
| button.primary | backgroundColor | rgba(0, 0, 0, 0) | rgb(35, 49, 39) |
| button.primary | borderTopWidth | 0px | 1px |
| button.primary | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderRightWidth | 0px | 1px |
| button.primary | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderBottomWidth | 0px | 1px |
| button.primary | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | borderLeftWidth | 0px | 1px |
| button.primary | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| button.primary | outlineWidth | 1.6px | 3px |
| button.primary | outlineColor | rgba(35, 112, 205, 0) | rgb(244, 246, 241) |
| button.primary | outlineOffset | 1.6px | 0px |
| button.primary | paddingRight | 0px | 10px |
| button.primary | paddingLeft | 0px | 10px |
| button.primary | marginLeft | 0px | 341.016px |
| button.primary | transitionProperty | box-shadow | all |
| button.primary | transitionDuration | 0.06s | 0s |
| composer.box | presence | absent | 1 |
| composer.button | presence | absent | 5 |
| composer.input | presence | absent | 1 |
| composer.model | presence | absent | 1 |
| home.greeting | count, size | 1, 92.2x32 | 1, 728x32 |
| home.greeting | fontFamily | anthropic-serif | sourceSerif4 |
| home.greeting | fontSize | 24px | 26px |
| home.greeting | fontWeight | 500 | 600 |
| home.greeting | letterSpacing | normal | -0.26px |
| home.greeting | whiteSpace | normal | nowrap |
| home.greeting | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| home.greeting | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| home.greeting | outlineWidth | 2.4px | 3px |
| home.greeting | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| project.card | count, size | 3, 474x64 | 1, 728x38 |
| project.card | fontFamily | anthropic-sans | instrumentSans |
| project.card | fontWeight | 400 | 450 |
| project.card | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| project.card | backgroundColor | rgba(0, 0, 0, 0) | rgb(253, 253, 251) |
| project.card | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| project.card | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| project.card | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| project.card | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| project.card | borderTopLeftRadius | 12px | 14px |
| project.card | borderTopRightRadius | 12px | 14px |
| project.card | borderBottomRightRadius | 12px | 14px |
| project.card | borderBottomLeftRadius | 12px | 14px |
| project.card | boxShadow | none | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.06) 0px 2px 8px 0px, rgb(220, 2 |
| project.card | outlineWidth | 2.4px | 3px |
| project.card | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
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
| shell.header | count, size | 1, 960x88 | 2, 1184x48 |
| shell.header | fontFamily | anthropic-sans | instrumentSans |
| shell.header | fontWeight | 400 | 450 |
| shell.header | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.header | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.header | outlineWidth | 2.4px | 3px |
| shell.header | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.header | paddingRight | 0px | 12px |
| shell.header | paddingBottom | 24px | 0px |
| shell.header | paddingLeft | 0px | 20px |
| shell.header | rowGap | 16px | 2px |
| shell.header | columnGap | 16px | 2px |
| shell.main | count, size | 1, 1440x900 | 1, 1184x884 |
| shell.main | display | block | flex |
| shell.main | position | absolute | relative |
| shell.main | fontFamily | anthropic-sans | instrumentSans |
| shell.main | fontWeight | 400 | 450 |
| shell.main | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.main | backgroundColor | hsl(none 0% 100%) | rgba(0, 0, 0, 0) |
| shell.main | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.main | outlineWidth | 2.4px | 3px |
| shell.main | outlineColor | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | count, size | 1, 288x900 | 1, 248x900 |
| shell.sidebar | position | absolute | relative |
| shell.sidebar | fontFamily | anthropic-sans | instrumentSans |
| shell.sidebar | fontWeight | 435 | 450 |
| shell.sidebar | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| shell.sidebar | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| shell.sidebar | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderRightWidth | 0.8px | 0px |
| shell.sidebar | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| shell.sidebar | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| shell.sidebar | outlineWidth | 2.4px | 3px |
| shell.sidebar | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| shell.sidebar | paddingTop | 0px | 12px |
| shell.sidebar | paddingRight | 0px | 12px |
| shell.sidebar | paddingBottom | 0px | 10px |
| shell.sidebar | paddingLeft | 0px | 12px |
| sidebar.footer | count, size | 19, 24x24 | 1, 224x40 |
| sidebar.footer | position | relative | static |
| sidebar.footer | fontFamily | anthropic-sans | instrumentSans |
| sidebar.footer | fontSize | 13px | 14px |
| sidebar.footer | fontWeight | 435 | 450 |
| sidebar.footer | lineHeight | 19px | 21px |
| sidebar.footer | whiteSpace | nowrap | normal |
| sidebar.footer | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.footer | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.footer | borderTopLeftRadius | 6px | 0px |
| sidebar.footer | borderTopRightRadius | 6px | 0px |
| sidebar.footer | borderBottomRightRadius | 6px | 0px |
| sidebar.footer | borderBottomLeftRadius | 6px | 0px |
| sidebar.footer | outlineWidth | 1.6px | 3px |
| sidebar.footer | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.footer | outlineOffset | 1.6px | 0px |
| sidebar.footer | paddingTop | 0px | 8px |
| sidebar.footer | rowGap | 6px | 2px |
| sidebar.footer | columnGap | 6px | 2px |
| sidebar.footer | transitionProperty | box-shadow | all |
| sidebar.footer | transitionDuration | 0.06s | 0s |
| sidebar.footer | transitionTimingFunction | cubic-bezier(0.4, 0, 0.2, 1) | ease |
| sidebar.footer | cursor | pointer | auto |
| sidebar.footer | textAlign | center | start |
| sidebar.navrow | count, size | 5, 66.3x20 | 1, 224x32 |
| sidebar.navrow | display | flex | inline-flex |
| sidebar.navrow | fontFamily | anthropic-sans | instrumentSans |
| sidebar.navrow | fontWeight | 435 | 600 |
| sidebar.navrow | lineHeight | 21px | 20px |
| sidebar.navrow | whiteSpace | normal | nowrap |
| sidebar.navrow | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.navrow | backgroundColor | rgba(0, 0, 0, 0) | rgb(210, 214, 204) |
| sidebar.navrow | borderTopWidth | 0px | 1px |
| sidebar.navrow | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderRightWidth | 0px | 1px |
| sidebar.navrow | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderBottomWidth | 0px | 1px |
| sidebar.navrow | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderLeftWidth | 0px | 1px |
| sidebar.navrow | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.navrow | borderTopLeftRadius | 0px | 8px |
| sidebar.navrow | borderTopRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomRightRadius | 0px | 8px |
| sidebar.navrow | borderBottomLeftRadius | 0px | 8px |
| sidebar.navrow | outlineWidth | 1.6px | 3px |
| sidebar.navrow | outlineStyle | solid | none |
| sidebar.navrow | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.navrow | outlineOffset | 1.6px | 0px |
| sidebar.navrow | paddingRight | 0px | 8px |
| sidebar.navrow | paddingLeft | 0px | 8px |
| sidebar.navrow | rowGap | normal | 10px |
| sidebar.navrow | columnGap | normal | 10px |
| sidebar.navrow | transitionDuration | 0s | 0.15s |
| sidebar.navrow | transitionTimingFunction | ease | cubic-bezier(0.4, 0, 0.2, 1) |
| sidebar.navrow | cursor | pointer | default |
| sidebar.navrow | textAlign | start | center |
| sidebar.row | count, size | 12, 268.8x32 | 2, 224x28 |
| sidebar.row | position | static | relative |
| sidebar.row | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row | fontWeight | 400 | 450 |
| sidebar.row | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row | borderTopStyle | none | solid |
| sidebar.row | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderRightStyle | none | solid |
| sidebar.row | borderRightColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderBottomStyle | none | solid |
| sidebar.row | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | borderLeftStyle | none | solid |
| sidebar.row | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(220, 223, 215) |
| sidebar.row | outlineWidth | 1.6px | 3px |
| sidebar.row | outlineStyle | solid | none |
| sidebar.row | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
| sidebar.row | outlineOffset | 1.6px | 0px |
| sidebar.row | paddingRight | 2px | 0px |
| sidebar.row | paddingLeft | 2px | 0px |
| sidebar.row | rowGap | 4px | normal |
| sidebar.row | columnGap | 4px | normal |
| sidebar.row | cursor | pointer | auto |
| sidebar.row | ::before | {"content":"\"\"","bg":"rgba(0, 0, 0, 0)","color":"rgba(0, 0, 0, 0.9)","radius":"0px","opa | null |
| sidebar.row.fill | count, size | 1, 288x900 | 1, 248x900 |
| sidebar.row.fill | position | absolute | relative |
| sidebar.row.fill | fontFamily | anthropic-sans | instrumentSans |
| sidebar.row.fill | fontWeight | 435 | 450 |
| sidebar.row.fill | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.row.fill | backgroundColor | rgb(250, 250, 250) | rgb(230, 231, 225) |
| sidebar.row.fill | borderTopColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderRightWidth | 0.8px | 0px |
| sidebar.row.fill | borderRightColor | rgba(0, 0, 0, 0.1) | rgb(29, 35, 31) |
| sidebar.row.fill | borderBottomColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | borderLeftColor | rgba(0, 0, 0, 0.08) | rgb(29, 35, 31) |
| sidebar.row.fill | outlineWidth | 2.4px | 3px |
| sidebar.row.fill | outlineColor | rgb(35, 112, 205) | rgb(29, 35, 31) |
| sidebar.row.fill | paddingTop | 0px | 12px |
| sidebar.row.fill | paddingRight | 0px | 12px |
| sidebar.row.fill | paddingBottom | 0px | 10px |
| sidebar.row.fill | paddingLeft | 0px | 12px |
| sidebar.section | count, size | 21, 24x24 | 3, 224x28 |
| sidebar.section | position | relative | static |
| sidebar.section | fontFamily | anthropic-sans | instrumentSans |
| sidebar.section | fontSize | 13px | 14px |
| sidebar.section | fontWeight | 435 | 450 |
| sidebar.section | lineHeight | 19px | 20px |
| sidebar.section | color | rgba(0, 0, 0, 0.9) | rgb(29, 35, 31) |
| sidebar.section | borderTopWidth | 0px | 1px |
| sidebar.section | borderTopColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderRightWidth | 0px | 1px |
| sidebar.section | borderRightColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderBottomWidth | 0px | 1px |
| sidebar.section | borderBottomColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderLeftWidth | 0px | 1px |
| sidebar.section | borderLeftColor | rgba(0, 0, 0, 0.08) | rgba(0, 0, 0, 0) |
| sidebar.section | borderTopLeftRadius | 6px | 8px |
| sidebar.section | borderTopRightRadius | 6px | 8px |
| sidebar.section | borderBottomRightRadius | 6px | 8px |
| sidebar.section | borderBottomLeftRadius | 6px | 8px |
| sidebar.section | outlineWidth | 1.6px | 3px |
| sidebar.section | outlineColor | rgba(35, 112, 205, 0) | rgb(29, 35, 31) |
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
| fontFamily (3 vs 2) | anthropic-sans x50<br>Anthropicons-Variable x42<br>anthropic-serif x2 | instrumentSans x24<br>sourceSerif4 x1 |
| fontSize (5 vs 6) | 20px x42<br>14px x31<br>12px x13<br>13px x7<br>24px x1 | 14px x8<br>12px x7<br>13px x7<br>20px x1<br>26px x1<br>15px x1 |
| fontWeight (6 vs 4) | 433.25 x41<br>400 x25<br>435 x23<br>500 x2<br>520 x2<br>577.75 x1 | 450 x10<br>500 x8<br>600 x6<br>650 x1 |
| lineHeight (6 vs 7) | 20px x48<br>21px x27<br>12px x9<br>17px x7<br>18px x2<br>32px x1 | 16px x7<br>20px x7<br>18px x7<br>26px x1<br>32px x1<br>21px x1<br>22.5px x1 |
| letterSpacing (1 vs 2) | normal x94 | normal x24<br>-0.26px x1 |
| color (6 vs 5) | rgba(0, 0, 0, 0.9) x67<br>rgba(0, 0, 0, 0.6) x22<br>rgb(16, 161, 34) x2<br>rgb(255, 255, 255) x1<br>rgb(174, 115, 3) x1<br>rgb(210, 95, 37) x1 | rgb(29, 35, 31) x11<br>rgb(75, 83, 77) x6<br>rgb(95, 102, 95) x5<br>rgb(244, 246, 241) x2<br>rgb(255, 255, 255) x1 |
| backgroundColor (12 vs 9) | rgb(255, 255, 255) x2<br>rgb(250, 250, 250) x1<br>hsl(none 0% 4.31373% / 0.05) x1<br>rgba(0, 0, 0, 0.1) x1<br>hsl(none 0% 4.31373% / 0.1) x1<br>rgb(37, 125, 224) x1<br>hsl(none 0% 100%) x1<br>rgb(25, 25, 25) x1<br>color(srgb 1 1 1 / 0.85) x1<br>oklab(0.616768 -0.158699 0.116515 / 0.1) x1<br>oklab(0.602709 0.0365174 0.122051 / 0.1) x1<br>oklab(0.61975 0.115669 0.111509 / 0.1) x1 | rgb(253, 253, 251) x5<br>rgb(230, 231, 225) x2<br>rgb(154, 101, 0) x2<br>rgb(35, 49, 39) x2<br>rgb(29, 35, 31) x1<br>rgb(210, 214, 204) x1<br>rgb(246, 246, 242) x1<br>rgb(168, 174, 166) x1<br>rgb(236, 238, 232) x1 |
| borderTopLeftRadius (6 vs 3) | 8px x76<br>6px x56<br>12px x9<br>7px x2<br>5px x2<br>2.68435e+07px x2 | 8px x19<br>3.35544e+07px x5<br>14px x4 |
| boxShadow (1 vs 4) | hsl(none 0% 4.31373% / 0.05) 0px 0px 0px 1px x1 | rgba(29, 35, 31, 0.06) 0px 1px 2px 0px, rgba(29, 35, 31, 0.0 x2<br>oklab(0.2486 -0.0105006 0.00462133 / 0.1) 0px 0px 0px 1px x1<br>rgb(220, 223, 215) 0px 0px 0px 1px x1<br>rgba(0, 0, 0, 0.06) 0px 4px 20px 0px, color(srgb 0.113725 0. x1 |
| borderTopColor (0 vs 2) |  | rgba(0, 0, 0, 0) x10<br>rgb(220, 223, 215) x1 |
| borderTopWidth (0 vs 1) |  | 1px x11 |
| paddingTop (4 vs 6) | 4px x6<br>16px x5<br>8px x2<br>1px x1 | 2px x3<br>12px x2<br>4px x1<br>8px x1<br>54px x1<br>6px x1 |
| paddingLeft (9 vs 10) | 2px x23<br>8px x18<br>4px x4<br>16px x3<br>10px x2<br>32px x2<br>1px x1<br>288px x1<br>9px x1 | 10px x5<br>8px x4<br>12px x3<br>2px x3<br>4px x2<br>9px x2<br>6px x1<br>20px x1<br>16px x1<br>14px x1 |
| rowGap (8 vs 7) | 4px x55<br>6px x37<br>2px x24<br>12px x10<br>8px x6<br>1.8px x2<br>5px x2<br>16px x1 | 6px x8<br>2px x5<br>8px x5<br>1px x5<br>4px x3<br>10px x2<br>12px x1 |
| columnGap (8 vs 7) | 4px x55<br>6px x37<br>2px x24<br>12px x10<br>8px x6<br>1.8px x2<br>5px x2<br>16px x1 | 6px x8<br>2px x5<br>1px x5<br>8px x4<br>10px x3<br>4px x3<br>12px x1 |
| transitionDuration (6 vs 1) | 0.06s x59<br>0.45s x33<br>0.12s x2<br>0.5s x1<br>0.15s x1<br>0.2s x1 | 0.15s x10 |
| transitionTimingFunction (5 vs 1) | cubic-bezier(0.4, 0, 0.2, 1) x35<br>linear(0 0%, 0.2459 7.14286%, 0.6526 14.2857%, 0.9468 21.428 x33<br>cubic-bezier(0.165, 0.84, 0.44, 1) x27<br>cubic-bezier(0.32, 0.72, 0, 1) x1<br>ease-out x1 | cubic-bezier(0.4, 0, 0.2, 1) x10 |
| animationName (1 vs 0) | task-grid-fade-in, task-grid-clip-reveal x1 |  |
| strokeWidth (0 vs 2) |  | 1.75px x14<br>1px x3 |

root custom properties: claude.ai 1383, cairn 72
