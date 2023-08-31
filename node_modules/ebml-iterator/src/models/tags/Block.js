import { concat } from 'uint8-util'

import EbmlDataTag from './EbmlDataTag.js'
import BlockLacing from '../enums/BlockLacing.js'
import Tools from '../../tools.js'
import EbmlTagId from '../enums/EbmlTagId.js'
import EbmlElementType from '../enums/EbmlElementType.js'

export default class Block extends EbmlDataTag {
  constructor (subTypeId) {
    super(subTypeId || EbmlTagId.Block, EbmlElementType.Binary)
  }

  writeTrackBuffer () {
    return Tools.writeVint(this.track)
  }

  writeValueBuffer () {
    const value = new DataView(new ArrayBuffer(2))
    value.setInt16(0, this.value)
    return new Uint8Array(value.buffer)
  }

  writeFlagsBuffer () {
    let flags = 0x00
    if (this.invisible) {
      flags |= 0x10
    }
    switch (this.lacing) {
      case BlockLacing.None:
        break
      case BlockLacing.Xiph:
        flags |= 0x04
        break
      case BlockLacing.EBML:
        flags |= 0x08
        break
      case BlockLacing.FixedSize:
        flags |= 0x0c
        break
    }
    return new Uint8Array([flags % 256])
  }

  encodeContent () {
    return concat([
      this.writeTrackBuffer(),
      this.writeValueBuffer(),
      this.writeFlagsBuffer(),
      this.payload
    ])
  }

  parseContent (data) {
    const track = Tools.readVint(data)
    this.track = track.value
    this.value = Tools.readSigned(data.subarray(track.length, track.length + 2))
    const flags = data[track.length + 2]
    this.invisible = Boolean(flags & 0x10)
    switch (flags & 0x0c) {
      case 0x00:
        this.lacing = BlockLacing.None
        break
      case 0x04:
        this.lacing = BlockLacing.Xiph
        break
      case 0x08:
        this.lacing = BlockLacing.EBML
        break
      case 0x0c:
        this.lacing = BlockLacing.FixedSize
        break
    }
    this.payload = data.slice(track.length + 3)
  }
}
