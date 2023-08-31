import { concat } from 'uint8-util'

import Tools from './tools.js'
import EbmlElementType from './models/enums/EbmlElementType.js'
import EbmlTagPosition from './models/enums/EbmlTagPosition.js'
import EbmlTagFactory from './models/EbmlTagFactory.js'

export default class EbmlIteratorDecoder {
  constructor (options = {}) {
    this._stream = options.stream
    this._currentBufferOffset = 0
    this._tagStack = []
    this._buffer = new Uint8Array()
    this._bufferTagIds = []
    this._bufferTagIds = options.bufferTagIds || []
  }

  get buffer () {
    return this._buffer
  }

  async * [Symbol.asyncIterator] (stream = this._stream) {
    for await (const chunk of stream) {
      yield * this.parseTags(chunk)
    }
  }

  * parseTags (chunk) {
    this._buffer = concat([this._buffer, chunk])
    while (true) {
      const currentTag = this.readTagHeader(this._buffer)
      if (!currentTag) {
        return null
      }
      if (currentTag.type === EbmlElementType.Master && !this._bufferTagIds.some(i => i === currentTag.id)) {
        this._tagStack.push(currentTag)
        yield this.createTag(currentTag, EbmlTagPosition.Start)
        this.advanceBuffer(currentTag.tagHeaderLength)
      } else {
        if (this._buffer.length < currentTag.tagHeaderLength + currentTag.size) {
          return null
        }
        const data = this._buffer.slice(currentTag.tagHeaderLength, currentTag.tagHeaderLength + currentTag.size)
        yield this.createTag(currentTag, EbmlTagPosition.Content, data)
        this.advanceBuffer(currentTag.tagHeaderLength + currentTag.size)
        while (this._tagStack.length > 0) {
          const nextTag = this._tagStack[this._tagStack.length - 1]
          if (this._currentBufferOffset < (nextTag.absoluteStart + nextTag.tagHeaderLength + nextTag.size)) {
            break
          }
          yield this.createTag(nextTag, EbmlTagPosition.End)
          this._tagStack.pop()
        }
      }
    }
  }

  advanceBuffer (length) {
    this._currentBufferOffset += length
    this._buffer = this._buffer.slice(length)
  }

  readTagHeader (buffer, offset = 0) {
    if (buffer.length === 0) return null

    const tag = Tools.readVint(buffer, offset)
    if (tag == null) return null

    const size = Tools.readVint(buffer, offset + tag.length)
    if (size == null) return null

    const tagIdHex = Tools.readHexString(buffer, offset, offset + tag.length)
    const tagId = Number.parseInt(tagIdHex, 16)
    const tagObject = EbmlTagFactory.create(tagId)
    tagObject.size = size.value
    return Object.assign(tagObject, {
      absoluteStart: this._currentBufferOffset + offset,
      tagHeaderLength: tag.length + size.length
    })
  }

  createTag (tag, position, data) {
    const emittedTag = EbmlTagFactory.create(tag.id)
    emittedTag.absoluteStart = tag.absoluteStart
    emittedTag.tagHeaderLength = tag.tagHeaderLength
    emittedTag.size = tag.size
    emittedTag.position = position
    if (position === EbmlTagPosition.Content) {
      emittedTag.parseContent(data)
    }
    return emittedTag
  }
}
