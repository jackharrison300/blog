import { Footer, Layout, Navbar, ThemeSwitch } from 'nextra-theme-blog'
import { Banner, Head, Search } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import Link from 'next/link'
import 'nextra-theme-blog/style.css'
 
export const metadata = {
  title: 'Zoomer Contemplation'
}
 
export default async function RootLayout({ children }) {
  console.log(await getPageMap('/'))
  return (
    <html lang="en" suppressHydrationWarning>
      <Head backgroundColor={{ dark: '#0f172a', light: '#fefce8' }} />
      <body>
        <Layout>
          <Navbar pageMap={await getPageMap('/')}>
            <Link href="/" style={{ marginRight: 'auto', fontWeight: 'bold', fontSize: '1.25rem' }}>
              Zoomer Contemplation
            </Link>
            <Search />
            <ThemeSwitch />
          </Navbar>
 
          {children}
 
          <Footer>
            <div></div>
          </Footer>
        </Layout>
      </body>
    </html>
  )
}
