import { concat } from 'uint8-util'

import Tools from '../../tools.js'
import Block from './Block.js'
import EbmlTagId from '../enums/EbmlTagId.js'

export default class SimpleBlock extends Block {
  constructor () {
    super(EbmlTagId.SimpleBlock)
  }

  encodeContent () {
    const flags = this.writeFlagsBuffer()
    if (this.keyframe) {
      flags[0] |= 0x80
    }
    if (this.discardable) {
      flags[0] |= 0x01
    }
    return concat([
      this.writeTrackBuffer(),
      this.writeValueBuffer(),
      flags,
      this.payload
    ])
  }

  parseContent (data) {
    super.parseContent(data)
    const track = Tools.readVint(data)
    const flags = data[track.length + 2]
    this.keyframe = Boolean(flags & 0x80)
    this.discardable = Boolean(flags & 0x01)
  }
}
