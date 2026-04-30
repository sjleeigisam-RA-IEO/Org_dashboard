import os
import re

def patch_modern_charts():
    with open('dashboard/app.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update plotOptions to hide data labels and make bars thinner/rounded
    # 2. Update yaxis to be cleaner
    # 3. Update tooltip for a more modern feel
    
    modern_plot_options = """plotOptions: { 
        bar: { 
          horizontal: false, 
          columnWidth: '55%',
          borderRadius: 6, 
          dataLabels: { total: { enabled: false } } 
        } 
      },
      dataLabels: { enabled: false },"""
      
    content = re.sub(r'plotOptions: \{ bar: \{.*?\} \},\s*dataLabels: \{ enabled: false \},', modern_plot_options, content, flags=re.DOTALL)

    # Update Tooltip
    modern_tooltip = """tooltip: {
        theme: 'light',
        y: {
          formatter: function (val) {
            return val.toLocaleString() + ' 십억원'
          }
        },
        style: {
          fontSize: '12px',
          fontFamily: 'Pretendard Variable'
        }
      },"""
    
    if 'tooltip:' not in content:
        content = content.replace("colors: ['#4f46e5',", modern_tooltip + "\n      colors: ['#4f46e5',")
    else:
        content = re.sub(r'tooltip: \{.*?\},', modern_tooltip, content, flags=re.DOTALL)

    # Ensure yaxis is clean
    content = content.replace("yaxis: { labels: { formatter: (val) => val.toLocaleString() + '십억' } }", "yaxis: { labels: { show: true, style: { colors: '#94a3b8' } } }")

    with open('dashboard/app.js', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == "__main__":
    patch_modern_charts()
