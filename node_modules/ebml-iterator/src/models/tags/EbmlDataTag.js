import EbmlTag from '../EbmlTag.js'
import EbmlElementType from '../enums/EbmlElementType.js'
import Tools from '../../tools.js'
import EbmlTagPosition from '../enums/EbmlTagPosition.js'

import { text2arr } from 'uint8-util'

export default class EbmlDataTag extends EbmlTag {
  constructor (id, type) {
    super(id, type, EbmlTagPosition.Content)
  }

  parseContent (data) {
    switch (this.type) {
      case EbmlElementType.UnsignedInt:
        this.data = Tools.readUnsigned(data)
        break
      case EbmlElementType.Float:
        this.data = Tools.readFloat(data)
        break
      case EbmlElementType.Integer:
        this.data = Tools.readSigned(data)
        break
      case EbmlElementType.String:
        this.data = String.fromCharCode(...data)
        break
      case EbmlElementType.UTF8:
        this.data = Tools.readUtf8(data)
        break
      default:
        this.data = data
        break
    }
  }

  encodeContent () {
    switch (this.type) {
      case EbmlElementType.UnsignedInt:
        return Tools.writeUnsigned(this.data)
      case EbmlElementType.Float:
        return Tools.writeFloat(this.data)
      case EbmlElementType.Integer:
        return Tools.writeSigned(this.data)
      case EbmlElementType.String:
        return text2arr(this.data)
      case EbmlElementType.UTF8:
        return text2arr(this.data)
      case EbmlElementType.Binary:
      default:
        return this.data
    }
  }
}
