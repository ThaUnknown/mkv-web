import { concat } from 'uint8-util'

import EbmlTag from '../EbmlTag.js'
import EbmlElementType from '../enums/EbmlElementType.js'
import EbmlTagPosition from '../enums/EbmlTagPosition.js'
import Tools from '../../tools.js'
import EbmlTagFactory from '../EbmlTagFactory.js'

export default class EbmlMasterTag extends EbmlTag {
  constructor (id, position = EbmlTagPosition.Content) {
    super(id, EbmlElementType.Master, position)
    this._children = []
  }

  get Children () {
    return this._children
  }

  set Children (value) {
    this._children = value
  }

  encodeContent () {
    return concat(this._children.map(child => child.encode()))
  }

  parseContent (content) {
    while (content.length > 0) {
      const tag = Tools.readVint(content)
      const size = Tools.readVint(content, tag.length)
      const tagIdHex = Tools.readHexString(content, 0, tag.length)
      const tagId = Number.parseInt(tagIdHex, 16)
      const tagObject = EbmlTagFactory.create(tagId)
      tagObject.size = size.value
      const totalTagLength = tag.length + size.length + size.value
      tagObject.parseContent(content.slice(tag.length + size.length, totalTagLength))
      this._children.push(tagObject)
      content = content.slice(totalTagLength)
    }
  }
}
