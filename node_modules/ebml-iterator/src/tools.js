export default class Tools {
  static readVint (arrayBuffer, start = 0) {
    const buffer = new Uint8Array(arrayBuffer)
    const length = 8 - Math.floor(Math.log2(buffer[start]))
    if (length > 8) {
      if (length === Infinity) throw new Error(`Unrepresentable length: ${length}`)
      const number = Tools.readHexString(buffer, start, start + length)
      throw new Error(`Unrepresentable length: ${length} ${number}`)
    }
    if (isNaN(length) || start + length > buffer.length) {
      return null
    }
    if (length === 8 && buffer[start + 1] >= 0x20 && buffer.subarray(start + 2, start + 8).some(i => i > 0x00)) {
      return {
        length: 8,
        value: -1
      }
    }
    let value = buffer[start] & ((1 << (8 - length)) - 1)
    for (let i = 1; i < length; i += 1) {
      value *= 2 ** 8
      value += buffer[start + i]
    }
    if (value === 2 ** (length * 7) - 1) {
      value = -1
    }
    return {
      length,
      value
    }
  }

  static writeVint (value, desiredLength) {
    if (value < 0 || value > 2 ** 53) {
      throw new Error(`Unrepresentable value: ${value}`)
    }
    let length = desiredLength
    if (!length) {
      for (length = 1; length <= 8; length += 1) {
        if (value < 2 ** (7 * length) - 1) {
          break
        }
      }
    }
    const buffer = new Uint8Array(length)
    let val = value
    for (let i = 1; i <= length; i += 1) {
      const b = val & 0xff
      buffer[length - i] = b
      val -= b
      val /= 2 ** 8
    }
    buffer[0] |= 1 << (8 - length)
    return buffer
  }

  static padStart (val) {
    if (val.length === 0) {
      return '00'
    }
    if (val.length === 1) {
      return '0' + val
    }
    return val
  }

  static readHexString (buf, start = 0, end = buf.byteLength) {
    return Array.from(new Uint8Array(buf).subarray(start, end))
      .map(q => Number(q).toString(16))
      .reduce((acc, current) => `${acc}${this.padStart(current)}`, '')
  }

  static readUtf8 (buff) {
    try {
      const decoder = new TextDecoder('utf-8')
      return decoder.decode(buff)
    } catch (exception) {
      return null
    }
  }

  static readUnsigned (buff) {
    const view = new DataView(buff.buffer, 0, buff.byteLength)
    if (buff.byteLength === 1) { view.getUint8(0) }
    if (buff.byteLength === 2) { view.getUint16(0) }
    if (buff.byteLength === 4) { view.getUint32(0) }
    if (buff.byteLength <= 6) {
      return new Uint8Array(buff).reduce((acc, current) => acc * 256 + current, 0)
    }
    const hex = Tools.readHexString(buff, 0, buff.byteLength)
    const num = parseInt(hex, 16)
    if (num <= Math.pow(256, 6)) {
      return num
    }
    return hex
  }

  static writeUnsigned (num) {
    if (typeof num === 'string') {
      return new Uint8Array(num.match(/[\da-f]{2}/gi).map((h) => parseInt(h, 16)))
    }
    const view = new DataView(new ArrayBuffer(8))
    view.setBigUint64(0, BigInt(num))
    let firstValueIndex = 0
    while (firstValueIndex < 7 && view.getUint8(firstValueIndex) === 0) {
      firstValueIndex++
    }
    return new Uint8Array(view.buffer.slice(firstValueIndex))
  }

  static readSigned (buff) {
    const b = new DataView(buff.buffer, 0, buff.byteLength)
    switch (buff.byteLength) {
      case 1:
        return b.getInt8(0)
      case 2:
        return b.getInt16(0)
      case 4:
        return b.getInt32(0)
      default:
        return NaN
    }
  }

  static writeSigned (num) {
    return new Int32Array([num])
  }

  static readFloat (buff) {
    const b = new DataView(buff.buffer, 0, buff.byteLength)
    switch (buff.byteLength) {
      case 4:
        return b.getFloat32(0)
      case 8:
        return b.getFloat64(0)
      default:
        return NaN
    }
  }

  static writeFloat (num) {
    return new Float32Array([num])
  }
}
