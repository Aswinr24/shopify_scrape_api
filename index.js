const express = require('express')
const axios = require('axios')
const xml2js = require('xml2js')
const cheerio = require('cheerio')
const cors = require('cors')
const Groq = require('groq-sdk')
require('dotenv').config()

const app = express()
const port = 8080

app.use(express.json())
app.use(cors())

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

app.post('/fetch-products', async (req, res) => {
  const { sitemapUrl } = req.body

  try {
    const response = await axios.get(sitemapUrl)
    const xmlData = response.data

    xml2js.parseString(xmlData, async (err, result) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to parse XML' })
      }
      let products = []
      let index = 0
      const urls = result.urlset.url
      while (products.length < 6 && index < urls.length) {
        const urlObj = urls[index]
        const imageObj = urlObj['image:image'] ? urlObj['image:image'][0] : {}
        const product = {
          link: urlObj.loc[0],
          image: imageObj['image:loc'] ? imageObj['image:loc'][0] : null,
          title: imageObj['image:title']
            ? imageObj['image:title'][0]
            : 'No title available',
        }
        if (product.image) {
          products.push(product)
        }

        index++
      }
      while (products.length < 6) {
        products.push({
          link: '#',
          image: 'path/to/placeholder-image.jpg', // Path to a placeholder image
          title: 'Placeholder Title',
        })
      }
      for (const product of products) {
        const productPage = await axios.get(product.link)
        const $ = cheerio.load(productPage.data)
        const productText = $('p')
          .map((i, el) => $(el).text())
          .get()
          .join('\n')

        const summaryResponse = await groq.chat.completions.create({
          messages: [
            {
              role: 'user',
              content: `Summarize the following product description in 3-4 short one line bullet points only about the product:\n\n${productText}`,
            },
          ],
          model: 'llama3-8b-8192',
        })
        product.summary = summaryResponse.choices[0]?.message?.content || ''
      }
      res.json(products)
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch products' })
  }
})

app.post('/fetch-sitemap', async (req, res) => {
  const { domain } = req.body

  try {
    const robotsUrl = `https://${domain}/robots.txt`
    console.log(robotsUrl)
    const robotsResponse = await axios.get(robotsUrl)
    console.log(robotsResponse)
    const robotsText = robotsResponse.data

    const sitemapMatch = robotsText.match(/Sitemap: (.*)/)
    if (!sitemapMatch) {
      return res
        .status(404)
        .json({ error: 'Sitemap URL not found in robots.txt' })
    }

    const sitemapUrl = sitemapMatch[1]
    console.log(sitemapUrl)
    const sitemapResponse = await axios.get(sitemapUrl)
    const xmlData = sitemapResponse.data
    xml2js.parseString(xmlData, (err, result) => {
      if (err) {
        console.log(err)
        return res.status(500).json({ error: 'Failed to parse sitemap XML' })
      }

      const sitemaps = result.sitemapindex && result.sitemapindex.sitemap
      if (!sitemaps) {
        return res
          .status(404)
          .json({ error: 'No sitemaps found in sitemap index' })
      }
      const productSitemapUrl = sitemaps.find((sitemapObj) =>
        sitemapObj.loc[0].includes('sitemap_products')
      )
      if (!productSitemapUrl) {
        return res.status(404).json({ error: 'No product sitemap URL found' })
      }
      res.json({ productSitemapUrl: productSitemapUrl.loc[0] })
    })
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: 'Failed to fetch sitemap' })
  }
})

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
